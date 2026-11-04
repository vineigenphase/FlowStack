import type { ReactNode } from "react";
import "./globals.css";

export const metadata = { title: "FlowStack", description: "Which apps your Xero ledger says you need." };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-GB">
      <body>{children}</body>
    </html>
  );
}
