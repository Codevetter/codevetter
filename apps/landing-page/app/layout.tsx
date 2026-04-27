import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "CodeVetter — Vet AI-generated code before it ships",
  description:
    "Desktop-first code review for agent-generated code. Runs offline. Multi-LLM. Catches what your agent misses.",
  metadataBase: new URL("https://codevetter.dev"),
  openGraph: {
    title: "CodeVetter",
    description:
      "Desktop-first code review for agent-generated code. Runs offline. Multi-LLM.",
    type: "website",
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@400;500;600;700&family=Inter:wght@300;400;500;600;700&family=JetBrains+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
      </head>
      <body>{children}</body>
    </html>
  );
}
