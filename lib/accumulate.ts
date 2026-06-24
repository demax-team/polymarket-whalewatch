import type { Trade } from "./types";
import { notionalUsd, dedupKey } from "./trades";

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
      };
      groups.set(key, g);
    }
    const usd = notionalUsd(t);
    if (t.side === "BUY") {
      g.buyUsd += usd;
      g.buyCount += 1;
      if (usd > g.maxSingleBuyUsd) g.maxSingleBuyUsd = usd;
    } else {
      g.sellUsd += usd;
      g.sellCount += 1;
    }
  }
  const out: AccumGroup[] = [];
  for (const g of groups.values()) {
    g.netUsd = g.buyUsd - g.sellUsd;
    if (
      g.netUsd >= minNetUsd &&
      g.buyCount >= minBuyCount &&
      g.maxSingleBuyUsd < splitCeiling &&
      g.buyUsd >= sideConsistency * g.sellUsd
    ) {
      out.push(g);
    }
  }
  out.sort((a, b) => b.netUsd - a.netUsd);
  return out;
}
