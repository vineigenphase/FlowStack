"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function FirmNav({ firm, digest = false }: { firm: string; digest?: boolean }) {
  const path = usePathname();
  const tabs = [
    { href: `/practice/${firm}`, label: "Clients" },
    { href: `/practice/${firm}/playbooks`, label: "Playbooks" },
    // v1.1 H: the Monday digest is parked; the tab shows only when MONDAY_DIGEST_ENABLED=true.
    ...(digest ? [{ href: `/practice/${firm}/digest`, label: "Monday digest" }] : []),
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
