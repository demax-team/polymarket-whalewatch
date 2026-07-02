"use client";

import { useEffect, useState } from "react";
import type { SmartInfoLite, WalletStatsLite } from "./ui";

// Lazily enrich wallet addresses with settled-market stats + smart-wallet flags
// via /api/wallet-stats. Mirrors the wallet-age enrichment pattern: progressive
// chunked fill, results accumulate, failures leave rows in the loading state
// for this pass (retried next time the wallet list changes).
export function useWalletIntel(wallets: (string | undefined)[]) {
  const [stats, setStats] = useState<Record<string, WalletStatsLite | null>>(
    {},
  );
  const [smart, setSmart] = useState<Record<string, SmartInfoLite | null>>({});

  useEffect(() => {
    const want = [
      ...new Set(
        wallets
          .map((w) => w?.toLowerCase())
          .filter((w): w is string => Boolean(w)),
      ),
    ].filter((w) => !(w in stats));
    if (want.length === 0) return;
    let cancelled = false;
    (async () => {
      // Chunk under the route's cap; sequential batches keep upstream fan-out sane.
      const CHUNK = 50;
      for (let i = 0; i < want.length && !cancelled; i += CHUNK) {
        const batch = want.slice(i, i + CHUNK);
        try {
          const res = await fetch("/api/wallet-stats", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ wallets: batch }),
          });
          const json = (await res.json()) as {
            stats?: Record<string, WalletStatsLite | null>;
            smart?: Record<string, SmartInfoLite>;
          };
          if (cancelled) return;
          const nextStats: Record<string, WalletStatsLite | null> = {};
          const nextSmart: Record<string, SmartInfoLite | null> = {};
          for (const w of batch) {
            nextStats[w] = json.stats?.[w] ?? null;
            nextSmart[w] = json.smart?.[w] ?? null;
          }
          setStats((prev) => ({ ...prev, ...nextStats }));
          setSmart((prev) => ({ ...prev, ...nextSmart }));
        } catch {
          // Best-effort enrichment; leave this batch showing "…".
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [wallets, stats]);

  return { stats, smart };
}
