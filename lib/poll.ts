import type { Trade } from "./types";
import { dedupKey } from "./trades";
export function selectNewTrades(
  fetched: Trade[],
  isSeen: (key: string) => boolean,
): Trade[] {
  return fetched
    .filter((t) => !isSeen(dedupKey(t)))
    .sort((a, b) => a.timestamp - b.timestamp);
}
