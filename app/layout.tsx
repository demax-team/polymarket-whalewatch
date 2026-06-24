import type { ReactNode } from "react";

export const metadata = {
  title: "Polymarket 大额成交监控",
  description: "只读监控面板：Polymarket 大额成交告警",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body
        style={{
          margin: 0,
          background: "#0b0e14",
          color: "#e6e6e6",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif",
        }}
      >
        {children}
      </body>
    </html>
  );
}
