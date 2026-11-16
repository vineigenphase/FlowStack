/** NEXT-STEPS P0.2: /demo guests read only the sample business; their answers never reach real data or metrics. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { freshDb } from "./helpers/db";
import { adminDb, withOrg } from "@/lib/db/client";
import { flagFeedback, flags, guestActions, orgs, shortlist } from "@/db/schema";
import { HttpError } from "@/lib/api";
import { fpReport } from "@/lib/feedback";
import {
  DEMO_ORG_UUID,
  ensureDemoOrg,
  guestAnswers,
  guestFeedback,
  guestReader,
  guestShortlist,
  guestShortlistAdd,
  newGuest,
  purgeGuests,
  undoGuestFeedback,
} from "@/lib/demo";
import { resetEnv } from "@/lib/env";

let close: () => Promise<void>;
let realOrg: string;

beforeAll(async () => {
  resetEnv();
  close = (await freshDb()).close;
  realOrg = (await (await adminDb()).insert(orgs).values({ name: "Real Business Ltd" }).returning())[0]!.id;
});
afterAll(() => close());

describe("demo business", () => {
  it("is created from fixtures on first use, labelled sample, with statements and flags", async () => {
    const id = await ensureDemoOrg(new Date("2026-11-04T10:00:00Z"));
    expect(id).toBe(DEMO_ORG_UUID);
    const [o] = await (await adminDb()).select().from(orgs).where(eq(orgs.id, id));
    expect(o).toMatchObject({ sample: true, name: expect.stringContaining("(sample)") });
    expect((await withOrg(id, (tx) => tx.select().from(flags))).length).toBeGreaterThan(0);
    expect(await ensureDemoOrg()).toBe(id); // second visit: no rebuild
  });

  it("refuses a DEMO_ORG_ID that is a real business", async () => {
    process.env.DEMO_ORG_ID = realOrg;
    resetEnv();
    await expect(ensureDemoOrg()).rejects.toBeInstanceOf(HttpError);
    delete process.env.DEMO_ORG_ID;
    resetEnv();
  });
});

describe("guest access", () => {
  it("reads only the demo business, only for 24 hours", () => {
    const g = newGuest(DEMO_ORG_UUID, 1_000);
    expect(guestReader(g, DEMO_ORG_UUID, 2_000)).toMatchObject({ guest: true, userId: null });
    expect(() => guestReader(g, realOrg, 2_000)).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => guestReader(g, DEMO_ORG_UUID, 1_000 + 24 * 3_600_000 + 1)).toThrow(expect.objectContaining({ status: 401 }));
    expect(() => guestReader({}, DEMO_ORG_UUID)).toThrow(expect.objectContaining({ status: 401 }));
  });

  it("guest feedback and shortlist stay out of flag_feedback, the shared shortlist and the FP report", async () => {
    const g = newGuest(DEMO_ORG_UUID).guestId;
    const [f] = await withOrg(DEMO_ORG_UUID, (tx) => tx.select().from(flags).where(eq(flags.state, "flagged")).limit(1));
    const before = await fpReport();
    const out = await guestFeedback(g, DEMO_ORG_UUID, f!.id, { answer: "numbers_wrong", subReason: "one_off" });
    expect(out).toMatchObject({ state: "queued", guest: true });
    expect((await guestAnswers(g)).get(f!.id)).toMatchObject({ answer: "numbers_wrong", subReason: "one_off" });
    await guestShortlistAdd(g, DEMO_ORG_UUID, "cin7", f!.lineKey);
    expect(await guestShortlist(g)).toEqual([expect.objectContaining({ appId: "cin7" })]);

    const db = await adminDb();
    expect(await db.select().from(flagFeedback)).toEqual([]);
    expect(await withOrg(DEMO_ORG_UUID, (tx) => tx.select().from(shortlist))).toEqual([]);
    expect(await fpReport()).toEqual(before);
    // The shared sample business didn't change.
    const [after] = await withOrg(DEMO_ORG_UUID, (tx) => tx.select().from(flags).where(eq(flags.id, f!.id)));
    expect(after!.state).toBe("flagged");
    // Another guest sees none of it.
    expect((await guestAnswers(newGuest(DEMO_ORG_UUID).guestId)).size).toBe(0);
    await undoGuestFeedback(g, f!.id);
    expect((await guestAnswers(g)).size).toBe(0);
  });

  it("everything a guest did is purged after 24 hours", async () => {
    const g = newGuest(DEMO_ORG_UUID).guestId;
    await guestShortlistAdd(g, DEMO_ORG_UUID, "katana");
    const db = await adminDb();
    await db.update(guestActions).set({ createdAt: new Date(Date.now() - 25 * 3_600_000) }).where(eq(guestActions.guestId, g));
    expect(await guestShortlist(g)).toEqual([]); // hidden at once
    expect(await purgeGuests()).toBeGreaterThan(0);
    expect(await db.select().from(guestActions).where(eq(guestActions.guestId, g))).toEqual([]);
  });
});
