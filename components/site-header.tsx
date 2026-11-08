import Link from "next/link";

/** Rail for pages outside an organisation (home, apps directory). */
export function SiteHeader() {
  return (
    <header className="top">
      <div className="wrap top-inner">
        <Link href="/" className="brand">FlowStack</Link>
        <span className="org-name" />
        <Link href="/practice" className="top-link">For firms</Link>
        <Link href="/apps" className="top-link">Apps</Link>
      </div>
    </header>
  );
}
