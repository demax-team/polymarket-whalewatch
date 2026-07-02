import { describe, it, expect, vi } from "vitest";
import { openDb } from "./db";
import {
  computeWalletStats,
  fetchClosedPositions,
  fetchResolvedOpenPositions,
  getWalletStats,
  type ResolvedOpenPosition,
  type WalletStats,
} from "./walletStats";

const stats = (over: Partial<WalletStats> = {}): WalletStats => ({
  winRate: 0.6,
  realizedPnl: 1000,
  roi: 0.2,
  settledCount: 10,
  truncated: false,
  ...over,
});

describe("computeWalletStats", () => {
  it("returns null winRate/roi for an empty history", () => {
    const s = computeWalletStats([], false);
    expect(s).toEqual({
      winRate: null,
      realizedPnl: 0,
      roi: null,
      settledCount: 0,
      truncated: false,
    });
  });

  it("counts wins (pnl > 0), sums pnl, and computes roi over cost basis", () => {
    // Cost basis uses totalBought * avgPrice — totalBought is SHARES, not USD.
    const s = computeWalletStats(
      [
        { realizedPnl: 200, totalBought: 1000, avgPrice: 0.5 }, // win, cost 500
        { realizedPnl: -100, totalBought: 500, avgPrice: 0.6 }, // loss, cost 300
        { realizedPnl: 0, totalBought: 100, avgPrice: 0.5 }, // break-even = not a win, cost 50
      ],
      true,
    );
    expect(s.settledCount).toBe(3);
    expect(s.winRate).toBeCloseTo(1 / 3);
    expect(s.realizedPnl).toBe(100);
    expect(s.roi).toBeCloseTo(100 / 850);
    expect(s.truncated).toBe(true);
  });
});

describe("computeWalletStats with resolved-open positions (survivorship fix)", () => {
  const zeroLoss = (cost: number): ResolvedOpenPosition => ({
    redeemable: true,
    curPrice: 0,
    cashPnl: -cost,
    initialValue: cost,
  });

  it("held-to-zero losers break a fake 100% win rate", () => {
    // 4 redeemed wins in closed-positions + 1 loser parked at zero.
    const closed = Array.from({ length: 4 }, () => ({
      realizedPnl: 100,
      totalBought: 400,
      avgPrice: 0.5,
    }));
    const s = computeWalletStats(closed, false, [zeroLoss(300)]);
    expect(s.settledCount).toBe(5);
    expect(s.winRate).toBeCloseTo(0.8); // was 1.0 before the fix
    expect(s.realizedPnl).toBe(400 - 300);
    expect(s.roi).toBeCloseTo(100 / (4 * 200 + 300));
  });

  it("counts an unredeemed win (curPrice=1) as a win with its final cashPnl", () => {
    const s = computeWalletStats([], false, [
      {
        redeemable: true,
        curPrice: 1,
        cashPnl: 500, // size*1 - cost, final at resolution
        initialValue: 500,
      },
    ]);
    expect(s.winRate).toBe(1);
    expect(s.realizedPnl).toBe(500);
    expect(s.settledCount).toBe(1);
  });
});

describe("fetchResolvedOpenPositions", () => {
  const row = (over: Record<string, unknown> = {}) => ({
    redeemable: true,
    curPrice: 0,
    cashPnl: -100,
    initialValue: 100,
    title: "M",
    ...over,
  });

  it("keeps only decided positions: live rows and 50/50 pushes are excluded", async () => {
    const page = [
      row(), // resolved loss → kept
      row({ curPrice: 1, cashPnl: 80 }), // unredeemed win → kept
      row({ redeemable: false, curPrice: 0.4 }), // live market → out
      row({ curPrice: 0.5 }), // push → out
      { bad: true }, // malformed → out
    ];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: true, json: async () => page }),
    );
    const { positions, truncated } = await fetchResolvedOpenPositions("0xabc");
    expect(positions).toHaveLength(2);
    expect(truncated).toBe(false);
  });

  it("paginates by offset until a short page", async () => {
    const fullPage = Array.from({ length: 50 }, () => row());
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => fullPage })
      .mockResolvedValueOnce({ ok: true, json: async () => [row()] });
    vi.stubGlobal("fetch", fetchMock);
    const { positions } = await fetchResolvedOpenPositions("0xabc");
    expect(positions).toHaveLength(51);
    expect(fetchMock.mock.calls[1][0]).toContain("offset=50");
  });
});

describe("fetchClosedPositions", () => {
  const pos = (pnl: number) => ({
    realizedPnl: pnl,
    totalBought: 100,
    avgPrice: 0.5,
    extraField: "ignored",
  });

  it("paginates by offset until a short page and drops malformed rows", async () => {
    const fullPage = Array.from({ length: 50 }, () => pos(1));
    const lastPage = [pos(2), { realizedPnl: "bad" }];
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => fullPage })
      .mockResolvedValueOnce({ ok: true, json: async () => lastPage });
    vi.stubGlobal("fetch", fetchMock);
    const { positions, truncated } = await fetchClosedPositions("0xabc");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain("offset=0");
    expect(fetchMock.mock.calls[1][0]).toContain("offset=50");
    expect(positions).toHaveLength(51); // malformed row dropped
    expect(truncated).toBe(false);
  });

  it("flags truncated when the page cap is hit with a full last page", async () => {
    const fullPage = Array.from({ length: 50 }, () => pos(1));
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => fullPage });
    vi.stubGlobal("fetch", fetchMock);
    const { positions, truncated } = await fetchClosedPositions("0xabc", {
      maxPages: 2,
    });
    expect(positions).toHaveLength(100);
    expect(truncated).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("throws on a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 500 }),
    );
    await expect(fetchClosedPositions("0xabc")).rejects.toThrow("500");
  });
});

describe("getWalletStats", () => {
  it("fetches misses and returns a wallet->stats map (keys lowercased)", async () => {
    const db = openDb(":memory:");
    const fetcher = vi.fn(async () => stats());
    const result = await getWalletStats(db, ["0xAAA"], { fetcher });
    expect(result["0xaaa"]).toEqual(stats());
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("serves a fresh cache hit without calling the fetcher", async () => {
    const db = openDb(":memory:");
    const fetcher = vi.fn(async () => stats());
    await getWalletStats(db, ["0xAAA"], { fetcher, nowSec: 1000 });
    const second = await getWalletStats(db, ["0xAAA"], {
      fetcher,
      nowSec: 1000 + 100,
    });
    expect(second["0xaaa"]).toEqual(stats());
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("refetches after the TTL expires", async () => {
    const db = openDb(":memory:");
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(stats())
      .mockResolvedValueOnce(stats({ realizedPnl: 2000 }));
    await getWalletStats(db, ["0xAAA"], { fetcher, nowSec: 1000 });
    const second = await getWalletStats(db, ["0xAAA"], {
      fetcher,
      nowSec: 1000 + 86_400, // exactly at TTL boundary → stale
    });
    expect(second["0xaaa"]?.realizedPnl).toBe(2000);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("returns null for a throwing fetcher and does NOT cache it", async () => {
    const db = openDb(":memory:");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetcher = vi
      .fn<() => Promise<WalletStats>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(stats());
    const first = await getWalletStats(db, ["0xAAA"], { fetcher });
    expect(first["0xaaa"]).toBeNull();
    const second = await getWalletStats(db, ["0xAAA"], { fetcher });
    expect(second["0xaaa"]).toEqual(stats());
    expect(fetcher).toHaveBeenCalledTimes(2);
    warnSpy.mockRestore();
  });

  it("preserves null winRate/roi through the cache round-trip", async () => {
    const db = openDb(":memory:");
    const empty = stats({
      winRate: null,
      roi: null,
      settledCount: 0,
      realizedPnl: 0,
    });
    const fetcher = vi.fn(async () => empty);
    await getWalletStats(db, ["0xAAA"], { fetcher, nowSec: 1000 });
    const second = await getWalletStats(db, ["0xAAA"], {
      fetcher,
      nowSec: 1001,
    });
    expect(second["0xaaa"]).toEqual(empty);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
