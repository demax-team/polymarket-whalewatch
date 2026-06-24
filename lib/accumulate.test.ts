import { describe, it, expect } from "vitest";
import { aggregate } from "./accumulate";

// Minimal Trade factory: only the fields aggregate() reads matter. `as any`
// keeps fixtures terse (mirrors lib/trades.test.ts).
function trade(over: Record<string, unknown>) {
  return {
    transactionHash: "0xtx",
    asset: "asset-A",
    proxyWallet: "0xW1",
    conditionId: "0xCOND",
    outcome: "Yes",
    side: "BUY",
    size: 1000,
    price: 1,
    title: "Will X happen?",
    eventSlug: "will-x-happen",
    ...over,
  } as any;
}

const DEFAULTS = {
  minNetUsd: 10_000,
  minBuyCount: 3,
  splitCeiling: 10_000,
};

describe("aggregate (split-buy accumulation)", () => {
  it("groups by (wallet,conditionId,outcome) and sums buy/sell + computes netUsd", () => {
    // One wallet, 4 sub-$10k BUYs ($5k each = $20k) on the same market/outcome.
    const trades = [
      trade({ transactionHash: "0x1", size: 5000, price: 1 }),
      trade({ transactionHash: "0x2", size: 5000, price: 1 }),
      trade({ transactionHash: "0x3", size: 5000, price: 1 }),
      trade({ transactionHash: "0x4", size: 5000, price: 1 }),
    ];
    const out = aggregate(trades, DEFAULTS);
    expect(out).toHaveLength(1);
    const g = out[0];
    expect(g.wallet).toBe("0xW1");
    expect(g.conditionId).toBe("0xCOND");
    expect(g.outcome).toBe("Yes");
    expect(g.buyUsd).toBe(20_000);
    expect(g.sellUsd).toBe(0);
    expect(g.netUsd).toBe(20_000);
    expect(g.buyCount).toBe(4);
    expect(g.sellCount).toBe(0);
    expect(g.maxSingleBuyUsd).toBe(5000);
  });

  it("separates different (wallet,conditionId,outcome) keys into distinct groups", () => {
    const trades = [
      // Group 1: W1 / Yes — 3 x $4k = $12k
      trade({ transactionHash: "0x1", proxyWallet: "0xW1", size: 4000 }),
      trade({ transactionHash: "0x2", proxyWallet: "0xW1", size: 4000 }),
      trade({ transactionHash: "0x3", proxyWallet: "0xW1", size: 4000 }),
      // Group 2: W2 / Yes — 3 x $7k = $21k
      trade({ transactionHash: "0x4", proxyWallet: "0xW2", size: 7000 }),
      trade({ transactionHash: "0x5", proxyWallet: "0xW2", size: 7000 }),
      trade({ transactionHash: "0x6", proxyWallet: "0xW2", size: 7000 }),
    ];
    const out = aggregate(trades, DEFAULTS);
    expect(out).toHaveLength(2);
    // Sorted by netUsd desc → W2 first.
    expect(out[0].wallet).toBe("0xW2");
    expect(out[0].netUsd).toBe(21_000);
    expect(out[1].wallet).toBe("0xW1");
    expect(out[1].netUsd).toBe(12_000);
  });

  it("EXCLUDES a group whose maxSingleBuyUsd >= splitCeiling (single-large trade, not a split)", () => {
    // 3 BUYs but one is $10k (== ceiling) → would have fired a single-trade alert.
    const trades = [
      trade({ transactionHash: "0x1", size: 10_000, price: 1 }),
      trade({ transactionHash: "0x2", size: 5000, price: 1 }),
      trade({ transactionHash: "0x3", size: 5000, price: 1 }),
    ];
    const out = aggregate(trades, DEFAULTS);
    expect(out).toHaveLength(0);
  });

  it("EXCLUDES groups with buyCount < minBuyCount", () => {
    // Only 2 BUYs (need >= 3), even though net is well over the floor.
    const trades = [
      trade({ transactionHash: "0x1", size: 9000, price: 1 }),
      trade({ transactionHash: "0x2", size: 9000, price: 1 }),
    ];
    const out = aggregate(trades, DEFAULTS);
    expect(out).toHaveLength(0);
  });

  it("EXCLUDES groups with netUsd < minNetUsd", () => {
    // 3 BUYs but only $9k total net — below the $10k floor.
    const trades = [
      trade({ transactionHash: "0x1", size: 3000, price: 1 }),
      trade({ transactionHash: "0x2", size: 3000, price: 1 }),
      trade({ transactionHash: "0x3", size: 3000, price: 1 }),
    ];
    const out = aggregate(trades, DEFAULTS);
    expect(out).toHaveLength(0);
  });

  it("EXCLUDES a churn wallet where buyUsd < 1.5x sellUsd (side-consistency guard)", () => {
    // buyUsd $24k, sellUsd $20k → ratio 1.2 < 1.5 → wash/churn, excluded.
    // (netUsd $4k would also fail the floor, so push buys/sells high to isolate the guard.)
    const trades = [
      trade({ transactionHash: "0x1", side: "BUY", size: 9000, price: 1 }),
      trade({ transactionHash: "0x2", side: "BUY", size: 9000, price: 1 }),
      trade({ transactionHash: "0x3", side: "BUY", size: 9000, price: 1 }),
      trade({ transactionHash: "0x4", side: "BUY", size: 9000, price: 1 }),
      // sellUsd = $30k → buyUsd $36k, ratio 1.2, net $6k < floor too; but guard catches it.
      trade({ transactionHash: "0x5", side: "SELL", size: 9999, price: 1 }),
      trade({ transactionHash: "0x6", side: "SELL", size: 9999, price: 1 }),
      trade({ transactionHash: "0x7", side: "SELL", size: 10_002, price: 1 }),
    ];
    const out = aggregate(trades, DEFAULTS);
    expect(out).toHaveLength(0);
  });

  it("KEEPS a group with some sells when buyUsd >= 1.5x sellUsd and net clears the floor", () => {
    // buyUsd $36k, sellUsd $12k → ratio 3.0 >= 1.5, net $24k >= floor.
    const trades = [
      trade({ transactionHash: "0x1", side: "BUY", size: 9000, price: 1 }),
      trade({ transactionHash: "0x2", side: "BUY", size: 9000, price: 1 }),
      trade({ transactionHash: "0x3", side: "BUY", size: 9000, price: 1 }),
      trade({ transactionHash: "0x4", side: "BUY", size: 9000, price: 1 }),
      trade({ transactionHash: "0x5", side: "SELL", size: 6000, price: 1 }),
      trade({ transactionHash: "0x6", side: "SELL", size: 6000, price: 1 }),
    ];
    const out = aggregate(trades, DEFAULTS);
    expect(out).toHaveLength(1);
    expect(out[0].buyUsd).toBe(36_000);
    expect(out[0].sellUsd).toBe(12_000);
    expect(out[0].netUsd).toBe(24_000);
    expect(out[0].buyCount).toBe(4);
    expect(out[0].sellCount).toBe(2);
  });

  it("dedups duplicate rows (same dedupKey counted once)", () => {
    // The duplicate (identical tx/asset/wallet/side/size) must NOT double-count.
    // Without dedup this would be 4 BUYs = $20k; with dedup it's 3 BUYs = $15k.
    const trades = [
      trade({ transactionHash: "0x1", size: 5000, price: 1 }),
      trade({ transactionHash: "0x1", size: 5000, price: 1 }), // exact dup of 0x1
      trade({ transactionHash: "0x2", size: 5000, price: 1 }),
      trade({ transactionHash: "0x3", size: 5000, price: 1 }),
    ];
    const out = aggregate(trades, DEFAULTS);
    expect(out).toHaveLength(1);
    expect(out[0].buyCount).toBe(3);
    expect(out[0].buyUsd).toBe(15_000);
    expect(out[0].netUsd).toBe(15_000);
  });

  it("returns results sorted by netUsd desc", () => {
    const trades = [
      // small: net $12k
      trade({ transactionHash: "0xa1", proxyWallet: "0xS", size: 4000 }),
      trade({ transactionHash: "0xa2", proxyWallet: "0xS", size: 4000 }),
      trade({ transactionHash: "0xa3", proxyWallet: "0xS", size: 4000 }),
      // big: net $27k
      trade({ transactionHash: "0xb1", proxyWallet: "0xB", size: 9000 }),
      trade({ transactionHash: "0xb2", proxyWallet: "0xB", size: 9000 }),
      trade({ transactionHash: "0xb3", proxyWallet: "0xB", size: 9000 }),
      // mid: net $18k
      trade({ transactionHash: "0xc1", proxyWallet: "0xM", size: 6000 }),
      trade({ transactionHash: "0xc2", proxyWallet: "0xM", size: 6000 }),
      trade({ transactionHash: "0xc3", proxyWallet: "0xM", size: 6000 }),
    ];
    const out = aggregate(trades, DEFAULTS);
    expect(out.map((g) => g.netUsd)).toEqual([27_000, 18_000, 12_000]);
  });
});
