import type { Metadata } from "next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FPL Tactix - Decision Intelligence & Strategy Engine for FPL",
  description:
    "Real-time decision intelligence and strategy engine for Fantasy Premier League. Live rank, AI optimization, xPts projections, league intelligence, and strategic planning.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased bg-slate-950 text-slate-50">
        <nav
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "12px 24px",
            borderBottom: "1px solid var(--card-border)",
            background: "var(--card)",
          }}
        >
          <a
            href="/"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <span
              style={{
                fontSize: 20,
                fontWeight: 800,
                background: "linear-gradient(135deg, #37003c, #963cff)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                letterSpacing: "-0.02em",
              }}
            >
              FPL Tactix
            </span>
          </a>
          <div style={{ display: "flex", gap: 16, alignItems: "center" }}>
            <a
              href="/dashboard"
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: "var(--muted)",
                textDecoration: "none",
              }}
            >
              Dashboard
            </a>
            <a
              href="/analytics"
              style={{
                fontSize: 14,
                fontWeight: 500,
                color: "var(--muted)",
                textDecoration: "none",
              }}
            >
              Analytics
            </a>
          </div>
        </nav>
        {children}
        <SpeedInsights />
        <Analytics />
      </body>
    </html>
  );
}
