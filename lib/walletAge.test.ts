import { describe, it, expect, vi } from "vitest";
import { openDb } from "./db";
import { getWalletAges } from "./walletAge";

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

  it("returns null for a fetcher that throws and does NOT cache it (next call retries)", async () => {
    const db = openDb(":memory:");
    const fetcher = vi
      .fn<(w: string) => Promise<number | null>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce(1700000000);
    const first = await getWalletAges(db, ["0xAAA"], { fetcher });
    expect(first).toEqual({ "0xaaa": null });
    // Not cached → a retry actually re-invokes the fetcher and now resolves.
    const second = await getWalletAges(db, ["0xAAA"], { fetcher });
    expect(second).toEqual({ "0xaaa": 1700000000 });
    expect(fetcher).toHaveBeenCalledTimes(2);
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
