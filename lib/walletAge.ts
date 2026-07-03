import type { DB } from "./db";
import { mapLimit } from "./mapLimit";

const DATA_API = "https://data-api.polymarket.com";

const PROBE_PAGE = 500;
const MAX_VERIFY_PROBES = 8;

// One /activity page. `_cb` busts Cloudflare's per-URL cache: the origin
// occasionally returns MIS-SORTED responses and the CDN then serves that bad
// payload for the same URL indefinitely (verified live 2026-07-02).
async function fetchActivityPage(
  wallet: string,
  params: string,
): Promise<{ timestamp: number }[]> {
  const cb =
    Date.now().toString(36) + Math.floor(Math.random() * 1e9).toString(36);
  const url = `${DATA_API}/activity?user=${encodeURIComponent(wallet)}&${params}&_cb=${cb}`;
  const res = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    headers: { "User-Agent": "polymarket-monitor" },
  });
  if (!res.ok) throw new Error(`fetchActivityPage ${res.status}`);
  const rows = await res.json();
  return Array.isArray(rows)
    ? rows.filter(
        (r): r is { timestamp: number } => typeof r?.timestamp === "number",
      )
    : [];
}

/**
 * First Polymarket activity timestamp (unix sec) for a wallet, or null if none.
 *
 * The API's sort is NOT trustworthy (sortBy=TIMESTAMP is usually honored but
 * the origin sometimes ignores it, and sortDirection WITHOUT sortBy doesn't
 * sort by time at all), so the sorted query only produces a CANDIDATE. The
 * candidate is then VERIFIED with the reliable `end` filter: an empty
 * `end=candidate-1` page proves nothing older exists. If older rows do come
 * back (the sort lied), we walk the candidate down by min(timestamp) until
 * the probe comes up empty.
 */
export async function fetchFirstActivityTs(
  wallet: string,
): Promise<number | null> {
  const sorted = await fetchActivityPage(
    wallet,
    "sortBy=TIMESTAMP&sortDirection=ASC&limit=10",
  );
  if (sorted.length === 0) return null;
  let candidate = Math.min(...sorted.map((r) => r.timestamp));
  for (let i = 0; i < MAX_VERIFY_PROBES; i++) {
    const older = await fetchActivityPage(
      wallet,
      `end=${candidate - 1}&limit=${PROBE_PAGE}`,
    );
    if (older.length === 0) return candidate; // proven: nothing earlier exists
    candidate = Math.min(...older.map((r) => r.timestamp));
  }
  // Hyperactive wallet + persistently lying sort: give the best (oldest seen)
  // candidate rather than nothing — an upper bound on the true age.
  console.warn(
    `[walletAge] first-ts unverified after ${MAX_VERIFY_PROBES} probes for ${wallet} — using best candidate`,
  );
  return candidate;
}

// Verified-empty cache TTL: a wallet with "no activity yet" can turn real any
// minute (it just traded — /activity may simply lag), so empty results are
// reused only briefly instead of being re-probed at FULL price (1 sorted page
// + up to MAX_VERIFY_PROBES) every single time the wallet appears.
const EMPTY_TTL_SEC = 3600;

// In-flight dedup across concurrent calls: the alert cycle's age filter and a
// wallet page opened at the same moment would otherwise EACH spend up to
// 1 + MAX_VERIFY_PROBES /activity requests on the same cold wallet. Keyed by
// lowercased wallet; entries drop once settled so failures retry next call.
const inFlightAges = new Map<string, Promise<number | null>>();

/**
 * Returns wallet(lowercased) -> firstTs with three distinct outcomes:
 *   number — verified first activity ts, persisted PERMANENTLY;
 *   null   — verified "no activity yet", persisted as a first_ts=NULL row and
 *            reused for EMPTY_TTL_SEC (then re-probed);
 *   ABSENT — the lookup THREW (timeout/5xx): never persisted and never
 *            reported as null, so callers can tell "fetch failed, retry later"
 *            from "verified empty" (the alert engine defers on absent).
 * Misses are fetched with a concurrency cap; concurrent calls share one
 * in-flight fetch per wallet. `fetcher`/`nowSec`/`inFlight` are injectable
 * for tests.
 */
export async function getWalletAges(
  db: DB,
  wallets: string[],
  opts: {
    concurrency?: number;
    fetcher?: (w: string) => Promise<number | null>;
    nowSec?: number;
    inFlight?: Map<string, Promise<number | null>>;
  } = {},
): Promise<Record<string, number | null>> {
  const {
    concurrency = 6,
    fetcher = fetchFirstActivityTs,
    nowSec = Math.floor(Date.now() / 1000),
    inFlight = inFlightAges,
  } = opts;
  const distinct = [...new Set(wallets.map((w) => w.toLowerCase()))];
  const sel = db.prepare(
    "SELECT first_ts, fetched_at FROM wallet_age WHERE wallet = ?",
  );
  const ins = db.prepare(
    "INSERT OR REPLACE INTO wallet_age (wallet, first_ts, fetched_at) VALUES (?, ?, ?)",
  );
  const result: Record<string, number | null> = {};
  const misses: string[] = [];
  for (const w of distinct) {
    const row = sel.get(w) as
      { first_ts: number | null; fetched_at: number | null } | undefined;
    if (row && row.first_ts !== null) {
      result[w] = row.first_ts; // a real first_ts never changes → permanent
    } else if (row && nowSec - (row.fetched_at ?? 0) < EMPTY_TTL_SEC) {
      result[w] = null; // verified-empty, still fresh
    } else {
      misses.push(w); // uncached, or a verified-empty row past its TTL
    }
  }
  // ok:false = the fetch THREW — kept apart from a successful "no activity"
  // (ok:true, ts:null) so only real failures stay uncached and absent.
  const fetched = await mapLimit(misses, concurrency, async (w) => {
    let p = inFlight.get(w);
    if (!p) {
      p = fetcher(w);
      inFlight.set(w, p);
      // Settle-time cleanup; the leading catch keeps a rejected fetch from
      // surfacing as unhandled here (every awaiter handles it below).
      p.catch(() => {}).finally(() => inFlight.delete(w));
    }
    try {
      return { ok: true as const, ts: await p };
    } catch (e) {
      console.warn(`[walletAge] first-ts lookup failed for ${w}:`, e);
      return { ok: false as const };
    }
  });
  misses.forEach((w, idx) => {
    const f = fetched[idx];
    if (!f.ok) return; // failed lookup: uncached AND absent from the result
    ins.run(w, f.ts, nowSec); // persists verified-empty (ts=null) rows too
    result[w] = f.ts;
  });
  return result;
}
