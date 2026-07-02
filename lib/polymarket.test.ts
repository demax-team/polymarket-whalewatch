import { it, expect, vi } from "vitest";
import { getLargeTrades, getTradesWindow } from "./polymarket";

// A factory for valid trade rows; override fields per test.
function trade(over: Record<string, unknown> = {}) {
  return {
    proxyWallet: "0x1",
    side: "BUY",
    asset: "9",
    conditionId: "0xc",
    size: 100,
    price: 0.5,
    timestamp: 1700000000,
    title: "M",
    slug: "s",
    eventSlug: "e",
    outcome: "Yes",
    outcomeIndex: 0,
    transactionHash: "0xh",
    ...over,
  };
}
it("requests the global trades feed with the CASH filter", async () => {
  const sample = [
    {
      proxyWallet: "0x1",
      side: "BUY",
      asset: "9",
      conditionId: "0xc",
      size: 5168.75,
      price: 0.999,
      timestamp: 1700000000,
      title: "M",
      slug: "s",
      eventSlug: "e",
      outcome: "Yes",
      outcomeIndex: 0,
      transactionHash: "0xh",
    },
  ];
  const fetchMock = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => sample });
  vi.stubGlobal("fetch", fetchMock);
  const trades = await getLargeTrades(10000);
  const url = fetchMock.mock.calls[0][0] as string;
  expect(url).toContain("filterType=CASH");
  expect(url).toContain("filterAmount=10000");
  expect(url).toContain("takerOnly=true");
  expect(trades[0].size).toBe(5168.75);
});
it("warns and falls back to raw when a row fails validation", async () => {
  const bad = [
    {
      proxyWallet: "0x1",
      side: "BUY",
      asset: "9",
      conditionId: "0xc",
      // size missing
      price: 0.999,
      timestamp: 1700000000,
      title: "M",
      slug: "s",
      eventSlug: "e",
      outcome: "Yes",
      outcomeIndex: 0,
      transactionHash: "0xh",
    },
  ];
  const fetchMock = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => bad });
  vi.stubGlobal("fetch", fetchMock);
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const trades = await getLargeTrades(10000);
  expect(warnSpy).toHaveBeenCalled();
  expect(trades).toEqual(bad);
  warnSpy.mockRestore();
});
it("warns on a full page (possible overflow)", async () => {
  const row = {
    proxyWallet: "0x1",
    side: "BUY",
    asset: "9",
    conditionId: "0xc",
    size: 5168.75,
    price: 0.999,
    timestamp: 1700000000,
    title: "M",
    slug: "s",
    eventSlug: "e",
    outcome: "Yes",
    outcomeIndex: 0,
    transactionHash: "0xh",
  };
  const fetchMock = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => [row] });
  vi.stubGlobal("fetch", fetchMock);
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  await getLargeTrades(10000, 1); // limit=1, one row => full page
  expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("full page"));
  warnSpy.mockRestore();
});

it("getTradesWindow stops at the first row older than sinceSec (in-window only, truncated:false)", async () => {
  // Single page mixing in-window and out-of-window rows; the second row is older.
  const sinceSec = 1700000000;
  const page = [
    trade({ timestamp: sinceSec + 100, transactionHash: "0xa" }), // in window
    trade({ timestamp: sinceSec - 1, transactionHash: "0xb" }), // older -> stop here
    trade({ timestamp: sinceSec + 50, transactionHash: "0xc" }), // never reached
  ];
  const fetchMock = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => page });
  vi.stubGlobal("fetch", fetchMock);
  const { trades, truncated } = await getTradesWindow({
    minUsd: 10000,
    sinceSec,
  });
  expect(truncated).toBe(false);
  expect(trades).toHaveLength(1);
  expect(trades[0].transactionHash).toBe("0xa");
  expect(fetchMock).toHaveBeenCalledTimes(1);
});

it("getTradesWindow puts side=BUY in the request URL", async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => [] });
  vi.stubGlobal("fetch", fetchMock);
  await getTradesWindow({
    minUsd: 10000,
    side: "BUY",
    sinceSec: 1700000000,
  });
  const url = fetchMock.mock.calls[0][0] as string;
  expect(url).toContain("side=BUY");
});

it("getTradesWindow returns truncated:true when it hits the page cap with all rows in-window", async () => {
  const sinceSec = 1700000000;
  // Every page is a full 500 rows, all newer than sinceSec -> never reaches the edge.
  const fullPage = Array.from({ length: 500 }, (_, i) =>
    trade({ timestamp: sinceSec + 1000, transactionHash: `0x${i}` }),
  );
  const fetchMock = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => fullPage });
  vi.stubGlobal("fetch", fetchMock);
  const { trades, truncated } = await getTradesWindow({
    minUsd: 10000,
    sinceSec,
    maxPages: 2,
  });
  expect(truncated).toBe(true);
  expect(trades).toHaveLength(1000); // 2 full pages
  expect(fetchMock).toHaveBeenCalledTimes(2);
});

it("getTradesWindow stops BEFORE the verified 3000 offset cap and reports truncated", async () => {
  const sinceSec = 1700000000;
  const fullPage = Array.from({ length: 500 }, (_, i) =>
    trade({ timestamp: sinceSec + 1000, transactionHash: `0x${i}` }),
  );
  const fetchMock = vi
    .fn()
    .mockResolvedValue({ ok: true, json: async () => fullPage });
  vi.stubGlobal("fetch", fetchMock);
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const { trades, truncated } = await getTradesWindow({
    minUsd: 2000,
    sinceSec,
    maxPages: 20,
  });
  expect(truncated).toBe(true);
  // offsets 0..3000 are legal (7 pages); offset 3500 must never be requested.
  expect(fetchMock).toHaveBeenCalledTimes(7);
  expect(trades).toHaveLength(3500);
  const urls = fetchMock.mock.calls.map((c) => c[0] as string);
  expect(urls.some((u) => u.includes("offset=3500"))).toBe(false);
  warnSpy.mockRestore();
});

it("getTradesWindow degrades a mid-pagination 400 (moved offset cap) to a truncated window", async () => {
  const sinceSec = 1700000000;
  const fullPage = Array.from({ length: 500 }, (_, i) =>
    trade({ timestamp: sinceSec + 1000, transactionHash: `0x${i}` }),
  );
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: true, json: async () => fullPage })
    .mockResolvedValueOnce({ ok: false, status: 400, json: async () => ({}) });
  vi.stubGlobal("fetch", fetchMock);
  const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  const { trades, truncated } = await getTradesWindow({
    minUsd: 2000,
    sinceSec,
  });
  expect(truncated).toBe(true);
  expect(trades).toHaveLength(500); // the fetched prefix survives
  warnSpy.mockRestore();
});

it("getTradesWindow still throws on a FIRST-page 400 (genuinely bad request)", async () => {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockResolvedValue({ ok: false, status: 400, json: async () => ({}) }),
  );
  await expect(
    getTradesWindow({ minUsd: 2000, sinceSec: 1700000000 }),
  ).rejects.toThrow("400");
});

it("getTradesWindow retries a transient 408 then succeeds", async () => {
  const sinceSec = 1700000000;
  const page = [
    trade({ timestamp: sinceSec + 100, transactionHash: "0xa" }),
    trade({ timestamp: sinceSec - 1, transactionHash: "0xb" }),
  ];
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce({ ok: false, status: 408, json: async () => ({}) })
    .mockResolvedValueOnce({ ok: true, json: async () => page });
  vi.stubGlobal("fetch", fetchMock);
  const { trades } = await getTradesWindow({ minUsd: 100000, sinceSec });
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(trades).toHaveLength(1);
  expect(trades[0].transactionHash).toBe("0xa");
});
