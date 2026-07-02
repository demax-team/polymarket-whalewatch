import type { DB } from "./db";
import { mapLimit } from "./mapLimit";

const DATA_API = "https://data-api.polymarket.com";

// First Polymarket activity timestamp (unix sec) for a wallet, or null if none/unknown.
// The activity endpoint sorted ASC returns the oldest row first; row[0].timestamp is
// the wallet's first on-chain Polymarket activity time.
export async function fetchFirstActivityTs(
  wallet: string,
): Promise<number | null> {
  const url = `${DATA_API}/activity?user=${wallet}&sortBy=TIMESTAMP&sortDirection=ASC&limit=1`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: { "User-Agent": "polymarket-monitor" },
  });
  if (!res.ok) throw new Error(`fetchFirstActivityTs ${res.status}`);
  const rows = await res.json();
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const ts = rows[0]?.timestamp;
  return typeof ts === "number" ? ts : null;
}

// Returns wallet(lowercased) -> firstTs|null. SQLite-cached; only real (non-null) ages
// are persisted permanently (errors stay uncached so they retry). Misses are fetched
// with a concurrency cap. `fetcher` is injectable for tests.
export async function getWalletAges(
  db: DB,
  wallets: string[],
  opts: {
    concurrency?: number;
    fetcher?: (w: string) => Promise<number | null>;
  } = {},
): Promise<Record<string, number | null>> {
  const { concurrency = 6, fetcher = fetchFirstActivityTs } = opts;
  const distinct = [...new Set(wallets.map((w) => w.toLowerCase()))];
  const sel = db.prepare("SELECT first_ts FROM wallet_age WHERE wallet = ?");
  const ins = db.prepare(
    "INSERT OR REPLACE INTO wallet_age (wallet, first_ts, fetched_at) VALUES (?, ?, ?)",
  );
  const result: Record<string, number | null> = {};
  const misses: string[] = [];
  for (const w of distinct) {
    const row = sel.get(w) as { first_ts: number | null } | undefined;
    if (row) result[w] = row.first_ts;
    else misses.push(w);
  }
  const fetched = await mapLimit(misses, concurrency, async (w) => {
    try {
      return await fetcher(w);
    } catch {
      return null;
    }
  });
  const now = Math.floor(Date.now() / 1000);
  misses.forEach((w, idx) => {
    const ts = fetched[idx];
    if (ts !== null) ins.run(w, ts, now); // cache only successful lookups
    result[w] = ts;
  });
  return result;
}
