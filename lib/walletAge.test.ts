import { describe, it, expect, vi } from "vitest";
import { openDb } from "./db";
import { fetchFirstActivityTs, getWalletAges } from "./walletAge";

// Stub the /activity endpoint per request. The API's SORT is untrustworthy,
// so fetchFirstActivityTs must verify its candidate with `end` probes.
const page = (rows: number[]) => ({
  ok: true,
  json: async () => rows.map((timestamp) => ({ timestamp })),
});

describe("fetchFirstActivityTs (probe-verified)", () => {
  it("returns the sorted candidate once the end-probe proves nothing older", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page([100, 120, 150])) // sorted query
      .mockResolvedValueOnce(page([])); // end=99 probe → empty = verified
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchFirstActivityTs("0xabc")).resolves.toBe(100);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain("sortBy=TIMESTAMP");
    expect(fetchMock.mock.calls[1][0]).toContain("end=99");
  });

  it("walks past a LYING sort: probe finds older rows → candidate moves down", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(page([500])) // sort claims 500 is first (wrong)
      .mockResolvedValueOnce(page([450, 300])) // end=499 → older rows exist
      .mockResolvedValueOnce(page([])); // end=299 → verified
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchFirstActivityTs("0xabc")).resolves.toBe(300);
    expect(fetchMock.mock.calls[2][0]).toContain("end=299");
  });

  it("returns null for a wallet with no activity", async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(page([]));
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchFirstActivityTs("0xabc")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caps probing and returns the best candidate for a hyperactive wallet", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    let ts = 1000;
    const fetchMock = vi.fn(async () => {
      ts -= 10;
      return page([ts]);
    });
    vi.stubGlobal("fetch", fetchMock);
    const result = await fetchFirstActivityTs("0xabc");
    expect(result).toBe(1000 - 10 * 9); // sorted call + 8 probes, best seen
    expect(fetchMock).toHaveBeenCalledTimes(9);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("unverified"));
    warnSpy.mockRestore();
  });
});

describe("getWalletAges", () => {
  it("fetches misses and returns a wallet->firstTs map", async () => {
    const db = openDb(":memory:");
    const fetcher = vi.fn(async (w: string) =>
      w === "0xaaa" ? 1700000000 : 1600000000,
    );
    const result = await getWalletAges(db, ["0xAAA", "0xBBB"], { fetcher });
    expect(result).toEqual({ "0xaaa": 1700000000, "0xbbb": 1600000000 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("hits the cache on a second call and does NOT call the fetcher again", async () => {
    const db = openDb(":memory:");
    const fetcher = vi.fn(async () => 1700000000);
    await getWalletAges(db, ["0xAAA"], { fetcher });
    expect(fetcher).toHaveBeenCalledTimes(1);
    const second = await getWalletAges(db, ["0xAAA"], { fetcher });
    expect(second).toEqual({ "0xaaa": 1700000000 });
    // still 1 — the second lookup was served from SQLite, not the fetcher.
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not drop wallets when the concurrency cap is below the wallet count", async () => {
    const db = openDb(":memory:");
    const wallets = Array.from({ length: 10 }, (_, i) => `0x${i}`);
    const fetcher = vi.fn(async (w: string) => Number(w.slice(2)) + 1);
    const result = await getWalletAges(db, wallets, {
      concurrency: 3,
      fetcher,
    });
    expect(Object.keys(result)).toHaveLength(10);
    for (let i = 0; i < 10; i++) {
      expect(result[`0x${i}`]).toBe(i + 1);
    }
    expect(fetcher).toHaveBeenCalledTimes(10);
  });

  it("leaves a throwing fetcher's wallet ABSENT (not null) and uncached, so the next call retries", async () => {
    const db = openDb(":memory:");
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetcher = vi
      .fn<(w: string) => Promise<number | null>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(1700000000);
    const first = await getWalletAges(db, ["0xAAA"], { fetcher });
    // Failed lookup ≠ verified-empty: the wallet is ABSENT, not null, so
    // callers (e.g. the alert engine) can defer instead of dropping for good.
    expect(first).toEqual({});
    expect(
      db.prepare("SELECT 1 FROM wallet_age WHERE wallet = ?").get("0xaaa"),
    ).toBeUndefined();
    // Not cached → a retry actually re-invokes the fetcher and now resolves.
    const second = await getWalletAges(db, ["0xAAA"], { fetcher });
    expect(second).toEqual({ "0xaaa": 1700000000 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("lookup failed"),
      expect.anything(),
    );
    warnSpy.mockRestore();
  });

  it("caches a verified-empty (null) result on a short TTL: reused while fresh, re-probed once stale", async () => {
    const db = openDb(":memory:");
    const fetcher = vi
      .fn<(w: string) => Promise<number | null>>()
      .mockResolvedValueOnce(null) // verified: genuinely no activity
      .mockResolvedValueOnce(1700000000); // …later the wallet turns real
    const first = await getWalletAges(db, ["0xAAA"], {
      fetcher,
      nowSec: 1000,
    });
    expect(first).toEqual({ "0xaaa": null });
    // Persisted as a first_ts=NULL row (previously never written at all).
    const row = db
      .prepare("SELECT first_ts, fetched_at FROM wallet_age WHERE wallet = ?")
      .get("0xaaa") as { first_ts: number | null; fetched_at: number };
    expect(row).toEqual({ first_ts: null, fetched_at: 1000 });
    // Inside the 1h TTL: served from SQLite, no re-probe.
    const second = await getWalletAges(db, ["0xAAA"], {
      fetcher,
      nowSec: 1000 + 3599,
    });
    expect(second).toEqual({ "0xaaa": null });
    expect(fetcher).toHaveBeenCalledTimes(1);
    // Past the TTL: re-probed, and the now-real first_ts replaces the row.
    const third = await getWalletAges(db, ["0xAAA"], {
      fetcher,
      nowSec: 1000 + 3600,
    });
    expect(third).toEqual({ "0xaaa": 1700000000 });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("dedupes concurrent lookups for the same wallet via the in-flight map", async () => {
    const db1 = openDb(":memory:");
    const db2 = openDb(":memory:");
    let release!: (v: number) => void;
    const gate = new Promise<number>((r) => (release = r));
    const fetcher = vi.fn((_w: string) => gate);
    const inFlight = new Map<string, Promise<number | null>>();
    // Two overlapping calls (alert cycle + wallet page) miss their caches
    // simultaneously — the second must JOIN the first's fetch, not start one.
    const p1 = getWalletAges(db1, ["0xAAA"], { fetcher, inFlight });
    const p2 = getWalletAges(db2, ["0xAAA"], { fetcher, inFlight });
    release(1700000000);
    const [r1, r2] = await Promise.all([p1, p2]);
    expect(r1).toEqual({ "0xaaa": 1700000000 });
    expect(r2).toEqual({ "0xaaa": 1700000000 });
    expect(fetcher).toHaveBeenCalledTimes(1);
    // Entry removed on settle so a later call fetches fresh (here: cache hit).
    expect(inFlight.size).toBe(0);
  });

  it("caches a successful null-free lookup so a real first_ts persists across calls", async () => {
    const db = openDb(":memory:");
    const fetcher = vi.fn(async () => 1650000000);
    await getWalletAges(db, ["0xABC"], { fetcher });
    const row = db
      .prepare("SELECT first_ts FROM wallet_age WHERE wallet = ?")
      .get("0xabc") as { first_ts: number } | undefined;
    expect(row?.first_ts).toBe(1650000000);
  });
});
