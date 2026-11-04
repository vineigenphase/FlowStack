import { handle, HttpError, type Params } from "@/lib/api";
import { getApp } from "@/lib/catalog/directory";

export const dynamic = "force-dynamic";

export const GET = handle(async (_req: Request, { params }: Params<{ id: string }>) => {
  const { id } = await params;
  const a = await getApp(id);
  if (!a) throw new HttpError(404, "App not found");
  return a;
});
