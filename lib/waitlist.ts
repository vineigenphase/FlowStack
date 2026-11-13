/** Waitlist (UI-SPEC §5.1). Owner connection only (RLS on, no grant for the app role). */
import { waitlist } from "@/db/schema";
import { adminDb } from "@/lib/db/client";

export async function joinWaitlist(input: { email: string; name: string; company: string; role: string; industry: string }, now = new Date()) {
  const db = await adminDb();
  // First sign-up wins; a repeat is a no-op (same response, so nobody can test whether an email is on the list).
  await db
    .insert(waitlist)
    .values({ email: input.email.toLowerCase(), name: input.name, company: input.company, role: input.role, industry: input.industry, consentAt: now })
    .onConflictDoNothing({ target: waitlist.email });
}
