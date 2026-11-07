"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function OrgNav({ org }: { org: string }) {
  const path = usePathname();
  const tabs = [
    { href: `/app/${org}`, label: "Summary" },
    { href: `/app/${org}/map`, label: "Stack map" },
    { href: `/app/${org}/statements/pl`, label: "Profit and loss" },
    { href: `/app/${org}/statements/bs`, label: "Balance sheet" },
    { href: `/app/${org}/statements/cf`, label: "Cash flow" },
    { href: `/app/${org}/after`, label: "After install" },
    { href: `/app/${org}/settings`, label: "Settings" },
  ];
  return (
    <nav className="tabs" aria-label="Organisation">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} aria-current={path === t.href ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
