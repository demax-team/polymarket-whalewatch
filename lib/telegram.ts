export interface TgCreds {
  botToken: string;
  chatId: string;
}
interface TgResponse {
  ok: boolean;
  parameters?: { retry_after?: number };
}
export async function sendMessage(
  creds: TgCreds,
  html: string,
  attempt = 0,
): Promise<void> {
  const res = await fetch(
    `https://api.telegram.org/bot${creds.botToken}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: creds.chatId,
        text: html,
        parse_mode: "HTML",
        disable_web_page_preview: true,
      }),
    },
  );
  const data: TgResponse = await res.json().catch(() => ({ ok: false }));
  if (!data.ok) {
    const retryAfter = data.parameters?.retry_after;
    if (retryAfter !== undefined && attempt < 5) {
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      return sendMessage(creds, html, attempt + 1);
    }
    throw new Error(
      `telegram sendMessage failed (status ${res.status}): ${JSON.stringify(data)}`,
    );
  }
}
