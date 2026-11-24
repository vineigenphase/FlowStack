"use client";

/** Copy-paste list of dev links. Shows full URLs for the site you're on; "Copy all" copies every URL, one per line. */
import { useState, useSyncExternalStore } from "react";
import type { LinkGroup } from "@/lib/dev/links";

const subscribe = () => () => {};

export function DevLinks({ groups, sites }: { groups: LinkGroup[]; sites?: { label: string; url: string }[] }) {
  const origin = useSyncExternalStore(subscribe, () => window.location.origin, () => "");
  const [copied, setCopied] = useState<string | null>(null);
  const full = (p: string) => `${origin}${p}`;
  const copy = (key: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(() => setCopied(key));
  };
  const all = groups.flatMap((g) => g.links.map((l) => `${l.label}: ${full(l.path)}`)).join("\n");
  return (
    <div className="dev-links">
      {sites ? (
        <p className="small">
          {sites.map((s, i) => (
            <span key={s.url}>
              {i ? " · " : ""}
              {s.label}: <a href={s.url}>{s.url}</a>
            </span>
          ))}
          <br />
          <span className="muted">Links below use the site you&apos;re on: {origin || "…"}</span>
        </p>
      ) : null}
      <p>
        <button type="button" className="btn ghost" onClick={() => copy("__all", all)}>
          {copied === "__all" ? "Copied all" : "Copy all links"}
        </button>
      </p>
      {groups.map((g) => (
        <section key={g.title}>
          <h3>{g.title}</h3>
          <ul className="dev-link-list">
            {g.links.map((l) => {
              const url = full(l.path);
              return (
                <li key={l.path + l.label}>
                  <span className="dev-link-label">
                    {l.label}
                    {l.note ? <span className="muted small"> ({l.note})</span> : null}
                  </span>
                  <a className="code small dev-link-url" href={l.path}>
                    {url}
                  </a>
                  <button type="button" className="link-btn small" onClick={() => copy(l.path + l.label, url)} aria-label={`Copy link: ${l.label}`}>
                    {copied === l.path + l.label ? "Copied" : "Copy"}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
