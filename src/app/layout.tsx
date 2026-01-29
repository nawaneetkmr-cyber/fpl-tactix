import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "FPL Tactix - Live FPL Rank, AI Optimization & What-If Simulator",
  description:
    "Real-time companion tool for Fantasy Premier League managers. Live rank tracking, AI-optimized squad analysis, and what-if simulations.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
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
          </div>
        </nav>
        {children}
      </body>
    </html>
  );
}
