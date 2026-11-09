"use client";

import { useRouter } from "next/navigation";
import { useId, useState } from "react";

type Opt = { value: string; label: string };
type Props = { id: string; actions: string[]; field?: string; categories: Opt[]; apps: Opt[] };

const LABEL: Record<string, string> = {
  publish: "Publish",
  reject: "Reject",
  mark_sent: "Mark as sent",
  confirm: "Confirm match",
  map: "Map account",
  add_alias: "Add as alias",
  accept: "Accept",
  note: "Add note",
  verify: "Verify fact",
  dismiss: "Dismiss",
};
/** Actions that need a written reason. */
const NEEDS_NOTE = new Set(["reject", "accept", "note"]);

/** One queue item's decision. Every resolution is audited server-side. */
export function QueueActions({ id, actions, field, categories, apps }: Props) {
  const router = useRouter();
  const uid = useId();
  const [action, setAction] = useState(actions[0] ?? "dismiss");
  const [note, setNote] = useState("");
  const [category, setCategory] = useState(categories[0]?.value ?? "");
  const [appId, setAppId] = useState(apps[0]?.value ?? "");
  const [value, setValue] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [msg, setMsg] = useState<{ text: string; error?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);

  const payload = (): Record<string, unknown> => {
    switch (action) {
      case "map":
        return { action, category };
      case "add_alias":
        return { action, app_id: appId };
      case "verify": {
        let v: unknown = value;
        try {
          v = JSON.parse(value);
        } catch {
          /* plain text */
        }
        return { action, field, value: v, source_url: sourceUrl };
      }
      case "dismiss":
        return note.trim() ? { action, note } : { action };
      default:
        return NEEDS_NOTE.has(action) ? { action, note } : { action };
    }
  };

  return (
    <form
      className="queue-actions"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setMsg(null);
        try {
          const res = await fetch(`/api/admin/queue/${id}/resolve`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload()),
          });
          const json = (await res.json().catch(() => ({}))) as { error?: string };
          if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
          setMsg({ text: "Done" });
          router.refresh();
        } catch (err) {
          setMsg({ text: (err as Error).message, error: true });
        } finally {
          setBusy(false);
        }
      }}
    >
      <fieldset className="choices">
        <legend className="sr-only">Decision</legend>
        {actions.map((a) => (
          <label key={a} className="chip">
            <input type="radio" name={`${uid}-a`} value={a} checked={action === a} onChange={() => setAction(a)} /> {LABEL[a] ?? a}
          </label>
        ))}
      </fieldset>
      {action === "map" ? (
        <label>
          Category{" "}
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {categories.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
      ) : null}
      {action === "add_alias" ? (
        <label>
          App{" "}
          <select value={appId} onChange={(e) => setAppId(e.target.value)}>
            {apps.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
      ) : null}
      {action === "verify" ? (
        <>
          <label>
            Value for {field ?? "the field"} <input required value={value} onChange={(e) => setValue(e.target.value)} />
          </label>
          <label>
            Where you saw it <input required type="url" placeholder="https://" value={sourceUrl} onChange={(e) => setSourceUrl(e.target.value)} />
          </label>
        </>
      ) : null}
      {NEEDS_NOTE.has(action) || action === "dismiss" ? (
        <label>
          {action === "reject" ? "Which rule it breaks" : action === "dismiss" ? "Note (optional)" : "Note"}{" "}
          <input required={NEEDS_NOTE.has(action)} minLength={NEEDS_NOTE.has(action) ? 3 : undefined} value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
      ) : null}
      <button type="submit" className="btn" disabled={busy}>{LABEL[action] ?? action}</button>
      <span className={msg?.error ? "refresh-msg error" : "refresh-msg"} role="status" aria-live="polite">{msg?.text ?? ""}</span>
    </form>
  );
}
