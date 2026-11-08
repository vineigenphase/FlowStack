import { z } from "zod";
import { body, handle, type Params } from "@/lib/api";
import { requireOrgMember } from "@/lib/auth/session";
import { ask } from "@/lib/llm/ask";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Ask a question about apps for this business (CLAUDE.md §7.4). */
export const POST = handle(async (req: Request, { params }: Params<{ org: string }>) => {
  const { org } = await params;
  await requireOrgMember(org);
  const b = await body(req, z.object({ question: z.string().trim().min(3).max(500) }));
  return ask(org, b.question);
});
