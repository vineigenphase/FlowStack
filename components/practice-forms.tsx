"use client";

import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";

type Msg = { text: string; error?: boolean } | null;

async function send(url: string, method: string, payload?: unknown) {
  const res = await fetch(url, {
    method,
    headers: payload === undefined ? undefined : { "content-type": "application/json" },
    body: payload === undefined ? undefined : JSON.stringify(payload),
  }).catch(() => null);
  const json = res ? ((await res.json().catch(() => ({}))) as Record<string, unknown>) : {};
  if (!res || !res.ok) throw new Error(String(json.error ?? (res ? `HTTP ${res.status}` : "Couldn't reach FlowStack")));
  return json;
}

function Status({ msg }: { msg: Msg }) {
  return (
    <span className={msg?.error ? "refresh-msg error" : "refresh-msg"} role="status" aria-live="polite">
      {msg?.text ?? ""}
    </span>
  );
}

export function CreateFirmForm() {
  const router = useRouter();
  const id = useId();
  const [name, setName] = useState("");
  const [msg, setMsg] = useState<Msg>(null);
  return (
    <form
      className="inline-form"
      onSubmit={async (e) => {
        e.preventDefault();
        try {
          const r = await send("/api/firms", "POST", { name });
          router.push(String(r.next));
        } catch (err) {
          setMsg({ text: (err as Error).message, error: true });
        }
      }}
    >
      <label htmlFor={id}>Practice name</label>
      <input id={id} required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
      <button type="submit" className="btn">Start practice</button>
      <Status msg={msg} />
    </form>
  );
}

export function InviteButton({ firm }: { firm: string }) {
  const [url, setUrl] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);
  return (
    <span className="post-button">
      <button
        type="button"
        className="btn ghost"
        onClick={async () => {
          try {
            const r = await send(`/api/firms/${firm}/invites`, "POST");
            setUrl(String(r.url));
            setMsg({ text: `Single use, valid for ${r.days} days. Send it to your colleague yourself.` });
          } catch (err) {
            setMsg({ text: (err as Error).message, error: true });
          }
        }}
      >
        Invite a colleague
      </button>
      {url ? <input className="invite-url" readOnly value={url} onFocus={(e) => e.currentTarget.select()} aria-label="Join link" /> : null}
      <Status msg={msg} />
    </span>
  );
}

export function PlaybookSelect({
  firm,
  industry,
  jobKey,
  jobLabel,
  options,
  value,
}: {
  firm: string;
  industry: string;
  jobKey: string;
  jobLabel: string;
  options: { id: string; name: string }[];
  value: string | null;
}) {
  const router = useRouter();
  const id = useId();
  const [v, setV] = useState(value ?? "");
  const [msg, setMsg] = useState<Msg>(null);
  return (
    <div className="pb-row">
      <label htmlFor={id}>{jobLabel}</label>
      <select
        id={id}
        value={v}
        onChange={async (e) => {
          const next = e.target.value;
          setV(next);
          setMsg(null);
          try {
            await send(`/api/firms/${firm}/playbooks`, "PUT", { industry, jobKey, appId: next || null });
            setMsg({ text: "Saved" });
            router.refresh();
          } catch (err) {
            setMsg({ text: (err as Error).message, error: true });
          }
        }}
      >
        <option value="">No standard</option>
        {options.map((o) => (
          <option key={o.id} value={o.id}>{o.name}</option>
        ))}
      </select>
      <Status msg={msg} />
    </div>
  );
}

export function NewProposalButton({ firm, org }: { firm: string; org: string }) {
  const router = useRouter();
  const [msg, setMsg] = useState<Msg>(null);
  return (
    <span className="post-button">
      <button
        type="button"
        className="btn"
        onClick={async () => {
          try {
            await send(`/api/firms/${firm}/proposals`, "POST", { orgId: org });
            router.refresh();
          } catch (err) {
            setMsg({ text: (err as Error).message, error: true });
          }
        }}
      >
        Draft a proposal from the fixes
      </button>
      <Status msg={msg} />
    </span>
  );
}

export function ProposalEditor({ firm, id, feeText, status, link }: { firm: string; id: string; feeText: string | null; status: string; link: string | null }) {
  const router = useRouter();
  const fid = useId();
  const [fee, setFee] = useState(feeText ?? "");
  const [msg, setMsg] = useState<Msg>(null);
  const act = async (payload: Record<string, unknown>, done: string) => {
    setMsg(null);
    try {
      await send(`/api/firms/${firm}/proposals/${id}`, "PATCH", payload);
      setMsg({ text: done });
      router.refresh();
    } catch (err) {
      setMsg({ text: (err as Error).message, error: true });
    }
  };
  return (
    <div className="stack-form">
      <label htmlFor={fid}>
        <span>Your fee, in your words (shown to the client as written)</span>
      </label>
      <textarea id={fid} maxLength={500} value={fee} onChange={(e) => setFee(e.target.value)} disabled={status === "accepted"} placeholder="e.g. Set-up and training: £1,200 one-off. Monthly review: £150." />
      <div className="inline-form">
        {status !== "accepted" ? (
          <button type="button" className="btn ghost" onClick={() => act({ feeText: fee || null }, "Saved")}>Save fee</button>
        ) : null}
        {status === "draft" ? (
          <button type="button" className="btn" onClick={() => act({ feeText: fee || null, status: "sent" }, "Link is live for 30 days")}>Make share link</button>
        ) : null}
        {status === "sent" ? (
          <button type="button" className="btn ghost" onClick={() => act({ status: "withdrawn" }, "Withdrawn: the link no longer works")}>Withdraw</button>
        ) : null}
        <Status msg={msg} />
      </div>
      {link && status === "sent" ? <input className="invite-url" readOnly value={link} onFocus={(e) => e.currentTarget.select()} aria-label="Proposal link" /> : null}
    </div>
  );
}

/** The client's view: tick fixes, see the £ at stake they cover, accept. */
export function ProposalChooser({
  token,
  items,
  initial,
  answered,
}: {
  token: string;
  items: { n: number; title: string; atStake: number }[];
  initial: number[];
  answered: boolean;
}) {
  const [chosen, setChosen] = useState<number[]>(initial);
  const [done, setDone] = useState(answered);
  const [msg, setMsg] = useState<Msg>(null);
  const total = useMemo(() => items.filter((i) => chosen.includes(i.n)).reduce((s, i) => s + i.atStake, 0), [items, chosen]);
  return (
    <form
      className="stack-form"
      onSubmit={async (e) => {
        e.preventDefault();
        setMsg(null);
        try {
          await send(`/api/p/${token}`, "POST", { chosen });
          setDone(true);
          setMsg({ text: "Thanks. Your adviser has your answer." });
        } catch (err) {
          setMsg({ text: (err as Error).message, error: true });
        }
      }}
    >
      <fieldset>
        <legend>Fixes to go ahead with</legend>
        {items.map((i) => (
          <label key={i.n} className="check-label">
            <input
              type="checkbox"
              disabled={done}
              checked={chosen.includes(i.n)}
              onChange={(e) => setChosen(e.target.checked ? [...chosen, i.n] : chosen.filter((x) => x !== i.n))}
            />
            {i.n}. {i.title}
          </label>
        ))}
      </fieldset>
      <p>
        Costs at stake in the fixes you&apos;ve ticked: <b className="num mark">£{Math.round(total).toLocaleString("en-GB")}</b>
      </p>
      {done ? null : (
        <div className="inline-form">
          <button type="submit" className="btn">Go ahead with these</button>
        </div>
      )}
      <Status msg={msg} />
    </form>
  );
}
