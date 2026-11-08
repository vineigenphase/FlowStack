"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function FirmNav({ firm }: { firm: string }) {
  const path = usePathname();
  const tabs = [
    { href: `/practice/${firm}`, label: "Clients" },
    { href: `/practice/${firm}/playbooks`, label: "Playbooks" },
    { href: `/practice/${firm}/digest`, label: "Monday digest" },
  ];
  return (
    <nav className="tabs" aria-label="Practice">
      {tabs.map((t) => (
        <Link key={t.href} href={t.href} aria-current={path === t.href ? "page" : undefined}>
          {t.label}
        </Link>
      ))}
    </nav>
  );
}
