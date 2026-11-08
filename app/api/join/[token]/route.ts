import { handle, type Params } from "@/lib/api";
import { getSession } from "@/lib/auth/session";
import { joinFirm } from "@/lib/firms";
import { signInHref } from "@/lib/ui/signin";

export const dynamic = "force-dynamic";

/** Open a join link: sign in first if needed, then join the practice and go to its home. */
export const GET = handle(async (req: Request, { params }: Params<{ token: string }>) => {
  const { token } = await params;
  const s = await getSession();
  if (!s.userId) {
    const here = new URL(req.url).pathname;
    return Response.redirect(new URL(signInHref(here).href, req.url), 303);
  }
  const firmId = await joinFirm(token, s.userId);
  return Response.redirect(new URL(`/practice/${firmId}`, req.url), 303);
});
