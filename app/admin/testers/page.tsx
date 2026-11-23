import { HttpError } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/session";
import { testersView } from "@/lib/access";
import { connectionUse } from "@/lib/me";
import { SiteHeader } from "@/components/site-header";
import { DevMount } from "@/components/dev/dev-mount";
import { PostButton } from "@/components/post-button";
import { NewCodeForm } from "@/components/new-code-form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Testers · FlowStack" };

const day = (d: Date | null) => (d ? new Date(d).toLocaleDateString("en-GB", { timeZone: "Europe/London", dateStyle: "medium" }) : "–");

/** Tester access (NEXT-STEPS P0.5): approve waitlist emails, make invite codes. Plain admin tables. */
export default async function TestersPage() {
  try {
    await requireAdmin();
  } catch (e) {
    if (!(e instanceof HttpError)) throw e;
    return (
      <>
        <SiteHeader />
      <DevMount />
        <main className="wrap">
          <h1>Testers</h1>
          <p>This page is for the FlowStack team.</p>
        </main>
      </>
    );
  }
  const [{ mode, people, codes }, use] = await Promise.all([testersView(), connectionUse()]);
  return (
    <>
      <SiteHeader />
      <DevMount />
      <main className="wrap">
        <h1>Testers</h1>
        <p className="meta">
          Access mode: <b>{mode}</b>
          {mode === "open" ? " (anyone can connect; set ACCESS_MODE=invite to require approval)" : " (connecting real Xero needs approval or a code)"} · Xero connections:{" "}
          <b>
            {use.used} of {use.cap}
          </b>
          {use.full ? " — full" : ""}
        </p>

        <h2>Waitlist</h2>
        {people.length === 0 ? (
          <p className="muted">Nobody on the waitlist yet.</p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Email</th>
                <th>Name</th>
                <th>Company</th>
                <th>Role</th>
                <th>Industry</th>
                <th>Joined</th>
                <th>Approved</th>
              </tr>
            </thead>
            <tbody>
              {people.map((p) => (
                <tr key={p.id}>
                  <td>{p.email}</td>
                  <td>{p.name}</td>
                  <td>{p.company}</td>
                  <td>{p.role}</td>
                  <td>{p.industry}</td>
                  <td>{day(p.createdAt)}</td>
                  <td>{p.approvedAt ? day(p.approvedAt) : <PostButton url="/api/admin/testers" payload={{ action: "approve", email: p.email }} label="Approve" done="Approved" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        <h2>Invite codes</h2>
        <NewCodeForm />
        {codes.length === 0 ? (
          <p className="muted">No codes yet.</p>
        ) : (
          <table className="tbl">
            <thead>
              <tr>
                <th>Code</th>
                <th>Note</th>
                <th>Used</th>
                <th>Expires</th>
                <th>Made by</th>
              </tr>
            </thead>
            <tbody>
              {codes.map((c) => (
                <tr key={c.code}>
                  <td>
                    <code>{c.code}</code>
                  </td>
                  <td>{c.note ?? ""}</td>
                  <td>
                    {c.uses} of {c.maxUses}
                  </td>
                  <td>{day(c.expiresAt)}</td>
                  <td>{c.createdBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </>
  );
}
