import { HttpError } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/session";
import { composeDigest } from "@/lib/digest";
import { SiteHeader } from "@/components/site-header";
import { DevMount } from "@/components/dev/dev-mount";

export const dynamic = "force-dynamic";
export const metadata = { title: "Digest preview · FlowStack" };

const day = (d: string | null) => (d ? new Date(d + "T00:00:00Z").toLocaleDateString("en-GB", { dateStyle: "medium", timeZone: "UTC" }) : "–");

/** Round-2 3d (UI-SPEC §5.16, NEXT-STEPS P2.13): the next monthly digest for a business, as it would be sent. Admins only. */
export default async function DigestPreview({ params }: { params: Promise<{ org: string }> }) {
  const { org } = await params;
  try {
    await requireAdmin();
  } catch (e) {
    if (!(e instanceof HttpError)) throw e;
    return (
      <>
        <SiteHeader />
      <DevMount />
        <main className="wrap">
          <h1>Digest preview</h1>
          <p>This page is for the FlowStack team.</p>
        </main>
      </>
    );
  }
  const d = /^[0-9a-f-]{36}$/i.test(org) ? await composeDigest(org) : null;
  return (
    <>
      <SiteHeader />
      <DevMount />
      <main className="wrap">
        <h1>Digest preview</h1>
        {!d ? (
          <p>No business with that id.</p>
        ) : (
          <>
            <ul className="plain">
              <li>Monthly emails: {d.optedIn ? "on" : "off"} for this business</li>
              <li>Would be sent on: {d.sendOn ? day(d.sendOn) : `no billing date (${d.subscription})`}</li>
              <li>Sending: not switched on (no email provider chosen yet)</li>
            </ul>
            <p>
              Subject: <b>{d.subject}</b>
            </p>
            <iframe title="Digest email" srcDoc={d.html} sandbox="" style={{ width: "100%", height: 640, border: "1px solid var(--line)", background: "#fff" }} />
            <h2>Plain-text version</h2>
            <pre style={{ whiteSpace: "pre-wrap" }}>{d.text}</pre>
          </>
        )}
      </main>
    </>
  );
}
