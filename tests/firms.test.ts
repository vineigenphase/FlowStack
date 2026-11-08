/** Practice plan (CLAUDE.md §1 Firm UX): clients ranked, flow bar, playbook drift, proposals by link, invites. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { freshDb } from "./helpers/db";
import { adminDb } from "@/lib/db/client";
import { firmInvites, firmMembers, orgMembers, orgs, proposals, users } from "@/db/schema";
import { runRefresh } from "@/lib/sync/refresh";
import { FixtureXeroClient } from "@/lib/xero/client";
import { driftFor, flowSegments } from "@/lib/firms/flow";
import {
  addClient,
  clientsView,
  createFirm,
  createInvite,
  createProposal,
  digest,
  joinFirm,
  proposalByToken,
  respondToProposal,
  setPlaybook,
  updateProposal,
} from "@/lib/firms";

describe("flow bar and drift (pure)", () => {
  it("worst job wins each segment; segments with no jobs in the figures are quiet", () => {
    const s = flowSegments([
      { key: "payroll", status: "gap" },
      { key: "rota", status: "connected" },
      { key: "data_capture", status: "connected" },
      { key: "spend_payables", status: "part_manual" },
      { key: "epos_ecommerce", status: "connected" },
    ]);
    expect(Object.fromEntries(s.map((x) => [x.key, x.state]))).toEqual({
      sales: "clean",
      payroll: "by_hand",
      purchases: "part_manual",
      collections: "quiet",
      payments: "quiet",
    });
  });

  it("drift: missing vs different", () => {
    const d = driftFor(
      [
        { jobKey: "payroll", appId: "staffology" },
        { jobKey: "data_capture", appId: "dext" },
        { jobKey: "spend_payables", appId: "pleo" },
      ],
      new Map([
        ["data_capture", ["autoentry"]],
        ["spend_payables", ["pleo"]],
      ]),
    );
    expect(d).toEqual([
      { job: "payroll", want: "staffology", have: [], kind: "missing" },
      { job: "data_capture", want: "dext", have: ["autoentry"], kind: "different" },
    ]);
  });
});

describe("practice (db)", () => {
  let close: () => Promise<void>;
  let partner: string;
  let colleague: string;
  let orgId: string;
  let firmId: string;

  beforeAll(async () => {
    const h = await freshDb();
    close = h.close;
    const db = await adminDb();
    partner = (await db.insert(users).values({ email: "partner@firm.test" }).returning())[0]!.id;
    colleague = (await db.insert(users).values({ email: "colleague@firm.test" }).returning())[0]!.id;
    orgId = (await db.insert(orgs).values({ name: "Copperpot (sample)", sample: true, industry: "hospitality" }).returning())[0]!.id;
    await db.insert(orgMembers).values({ orgId, userId: partner, role: "owner" });
    await runRefresh(orgId, { client: new FixtureXeroClient("demo-uk-synthetic", orgId), now: new Date("2026-11-04T10:00:00Z") });
    firmId = (await createFirm(partner, "Ledger & Co")).id;
  });
  afterAll(() => close());

  it("only someone who connected the client can add it", async () => {
    await expect(addClient(firmId, colleague, orgId)).rejects.toMatchObject({ status: 403 });
    await addClient(firmId, partner, orgId);
    const c = await clientsView(firmId);
    expect(c).toHaveLength(1);
    expect(c[0]!.atStake).toBeGreaterThan(0);
    expect(c[0]!.segments.find((s) => s.key === "payroll")?.state).toBe("by_hand");
    expect(c[0]!.tags).toContain("fixes_ready");
  });

  it("invite links are single use", async () => {
    const i = await createInvite(firmId, partner);
    expect(await joinFirm(i.token, colleague)).toBe(firmId);
    await expect(joinFirm(i.token, colleague)).rejects.toMatchObject({ status: 410 });
    const db = await adminDb();
    expect((await db.select().from(firmMembers).where(eq(firmMembers.firmId, firmId))).map((m) => m.role).sort()).toEqual(["member", "owner"]);
    // Expired links don't work either.
    const old = await createInvite(firmId, partner);
    await db.update(firmInvites).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(firmInvites.token, old.token));
    await expect(joinFirm(old.token, partner)).rejects.toMatchObject({ status: 410 });
  });

  it("playbook drift shows on the client", async () => {
    await setPlaybook(firmId, partner, "hospitality", "payroll", "staffology");
    await expect(setPlaybook(firmId, partner, "hospitality", "payroll", "dext")).rejects.toMatchObject({ status: 422 });
    const [c] = await clientsView(firmId);
    expect(c!.drift).toEqual([expect.objectContaining({ job: "payroll", kind: "missing", wantName: "Staffology Payroll" })]);
  });

  it("proposal: draft → share link → client ticks fixes → answered; links die when withdrawn or expired", async () => {
    const p = await createProposal(firmId, orgId, partner, null);
    expect(p.items.length).toBeGreaterThan(0);
    expect(p.items[0]!.lines.length).toBeGreaterThan(0);
    expect(await proposalByToken(p.token)).toBeNull(); // drafts aren't public
    await updateProposal(firmId, p.id, partner, { feeText: "Set-up £1,200 one-off.", status: "sent" });
    const pub = await proposalByToken(p.token);
    expect(pub).toMatchObject({ firmName: "Ledger & Co", orgName: "Copperpot (sample)", sample: true });
    expect(pub!.p.feeText).toBe("Set-up £1,200 one-off.");
    expect((await clientsView(firmId))[0]!.tags).toContain("proposal_out");

    await expect(respondToProposal(p.token, [999])).rejects.toMatchObject({ status: 422 });
    const r = await respondToProposal(p.token, [p.items[0]!.n, p.items[0]!.n]);
    expect(r).toMatchObject({ status: "accepted", chosen: [p.items[0]!.n] });
    await expect(respondToProposal(p.token, [p.items[0]!.n])).rejects.toMatchObject({ status: 409 });
    const d = await digest(firmId);
    expect(d.acceptedThisWeek).toHaveLength(1);

    const q = await createProposal(firmId, orgId, partner, null);
    await updateProposal(firmId, q.id, partner, { status: "sent" });
    await updateProposal(firmId, q.id, partner, { status: "withdrawn" });
    expect(await proposalByToken(q.token)).toBeNull();

    const x = await createProposal(firmId, orgId, partner, null);
    await updateProposal(firmId, x.id, partner, { status: "sent" });
    const db = await adminDb();
    await db.update(proposals).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(proposals.id, x.id));
    expect(await proposalByToken(x.token)).toBeNull();
    expect(await proposalByToken("not a token!")).toBeNull();
  });

  it("another firm can't draft proposals for a client it doesn't have", async () => {
    const other = await createFirm(colleague, "Other LLP");
    await expect(createProposal(other.id, orgId, colleague, null)).rejects.toMatchObject({ status: 404 });
  });
});
