// Concurrency-capped map: runs `fn` over `items` with at most `limit` in flight.
// Preserves input order in the result. Shared by the wallet enrichment fetchers
// (age / stats), which all fan out one upstream request per wallet.
export async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (x: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const worker = async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) || 0 }, worker),
  );
  return out;
}
