import { timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { HttpError } from "@/lib/api";

/** Vercel Cron sends `Authorization: Bearer CRON_SECRET`. */
export function requireCron(req: Request) {
  const secret = env().CRON_SECRET;
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  const ok = secret.length >= 16 && got.length === want.length && timingSafeEqual(Buffer.from(got), Buffer.from(want));
  if (!ok) throw new HttpError(401, "Unauthorised");
}
