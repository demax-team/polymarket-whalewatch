import type { Trade } from "./types";
import { notionalUsd, dedupKey } from "./trades";

// One BUY trade, kept for the expandable underlying-orders detail.
export interface AccumBuy {
  ts: number;
  usd: number;
  price: number;
}

export interface AccumGroup {
  wallet: string;
  conditionId: string;
  outcome: string;
  title: string;
  eventSlug: string;
  buyUsd: number;
  sellUsd: number;
  netUsd: number;
  buyCount: number;
  sellCount: number;
  maxSingleBuyUsd: number;
  // Size-weighted average BUY price (the odds the wallet accumulated at):
  // buyUsd / buyShares, or 0 when there are no buys.
  buyShares: number;
  avgBuyPrice: number;
  // Timestamp span across ALL trades in the group (buy AND sell).
  firstTs: number;
  lastTs: number;
  // Each BUY trade, sorted newest-first, for the expandable detail row.
  buys: AccumBuy[];
}

export interface AccumOptions {
  minNetUsd: number; // display/alert floor on net buy-in
  minBuyCount: number; // >= this many BUY trades to qualify as "split"
  splitCeiling: number; // every BUY must be < this (else it'd have fired a single-trade alert)
  sideConsistency?: number; // require buyUsd >= sideConsistency * sellUsd (default 1.5)
}

// Group the trade feed by (wallet, conditionId, outcome) to surface split-buy accumulation.
// Dedup within the pull first: offset pagination re-serves boundary rows and one tx carries
// multiple fills, so summing raw rows would double-count.
export function aggregate(trades: Trade[], opts: AccumOptions): AccumGroup[] {
  const { minNetUsd, minBuyCount, splitCeiling, sideConsistency = 1.5 } = opts;
  const seen = new Set<string>();
  const groups = new Map<string, AccumGroup>();
  for (const t of trades) {
    const dk = dedupKey(t);
    if (seen.has(dk)) continue;
    seen.add(dk);
    const key = `${t.proxyWallet}:${t.conditionId}:${t.outcome}`;
    let g = groups.get(key);
    if (!g) {
      g = {
        wallet: t.proxyWallet,
        conditionId: t.conditionId,
        outcome: t.outcome,
        title: t.title,
        eventSlug: t.eventSlug,
        buyUsd: 0,
        sellUsd: 0,
        netUsd: 0,
        buyCount: 0,
        sellCount: 0,
        maxSingleBuyUsd: 0,
        buyShares: 0,
        avgBuyPrice: 0,
        firstTs: t.timestamp,
        lastTs: t.timestamp,
        buys: [],
      };
      groups.set(key, g);
    }
    // Track the timestamp span across ALL trades (buy and sell).
    if (t.timestamp < g.firstTs) g.firstTs = t.timestamp;
    if (t.timestamp > g.lastTs) g.lastTs = t.timestamp;
    const usd = notionalUsd(t);
    if (t.side === "BUY") {
      g.buyUsd += usd;
      g.buyCount += 1;
      g.buyShares += t.size;
      g.buys.push({ ts: t.timestamp, usd, price: t.price });
      if (usd > g.maxSingleBuyUsd) g.maxSingleBuyUsd = usd;
    } else {
      g.sellUsd += usd;
      g.sellCount += 1;
    }
  }
  const out: AccumGroup[] = [];
  for (const g of groups.values()) {
    g.netUsd = g.buyUsd - g.sellUsd;
    g.avgBuyPrice = g.buyShares > 0 ? g.buyUsd / g.buyShares : 0;
    if (
      g.netUsd >= minNetUsd &&
      g.buyCount >= minBuyCount &&
      g.maxSingleBuyUsd < splitCeiling &&
      g.buyUsd >= sideConsistency * g.sellUsd
    ) {
      // Surface the underlying BUYs newest-first for the expandable detail.
      g.buys.sort((a, b) => b.ts - a.ts);
      out.push(g);
    }
  }
  out.sort((a, b) => b.netUsd - a.netUsd);
  return out;
}
