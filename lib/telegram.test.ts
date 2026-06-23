import { describe, it, expect, vi, beforeEach } from "vitest";
import { sendMessage } from "./telegram";
beforeEach(() => vi.restoreAllMocks());
describe("sendMessage", () => {
  it("POSTs to the bot sendMessage endpoint with HTML parse_mode", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    vi.stubGlobal("fetch", fetchMock);
    await sendMessage({ botToken: "T", chatId: "@c" }, "hello");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("/botT/sendMessage");
    expect(JSON.parse(init.body).parse_mode).toBe("HTML");
    expect(JSON.parse(init.body).chat_id).toBe("@c");
  });
  it("retries after retry_after then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        status: 429,
        json: async () => ({ ok: false, parameters: { retry_after: 0 } }),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      });
    vi.stubGlobal("fetch", fetchMock);
    await sendMessage({ botToken: "T", chatId: "@c" }, "hi");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("throws after exhausting retries", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 429,
      json: async () => ({ ok: false, parameters: { retry_after: 0 } }),
    });
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      sendMessage({ botToken: "T", chatId: "@c" }, "hi"),
    ).rejects.toThrow();
    expect(fetchMock).toHaveBeenCalledTimes(6);
  });
});
