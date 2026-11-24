import type { ReactNode } from "react";
import { IBM_Plex_Mono, Inter } from "next/font/google";
import "./tokens.css";
import "./globals.css";

// Owner restyle 22 Nov 2026 (ENGINE-V2 Phase 3): Inter for headings and body; IBM Plex Mono only for codes and IDs.
const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const mono = IBM_Plex_Mono({ subsets: ["latin"], weight: ["400", "600"], variable: "--font-mono", display: "swap" });

export const metadata = { title: "FlowStack", description: "Which apps your Xero ledger says you need." };

/**
 * Light by default; dark only when the user chose it in Settings (stored in this browser). Applied before first paint
 * so there's no flash, and without reading cookies (pages stay as static as they were).
 */
const THEME_SCRIPT = `try{if(localStorage.getItem("fs-theme")==="dark")document.documentElement.dataset.theme="dark"}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB" className={`${sans.variable} ${mono.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
