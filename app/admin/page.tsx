import { redirect } from "next/navigation";
import { HttpError } from "@/lib/api";
import { requireAdmin } from "@/lib/auth/session";
import { SiteHeader } from "@/components/site-header";
import { AdminSignIn } from "@/components/admin-sign-in";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin sign-in · FlowStack" };

/** The admin front door: admins go straight to the dev links page; everyone else gets the sign-in button. */
export default async function AdminHome() {
  try {
    await requireAdmin();
  } catch (e) {
    if (!(e instanceof HttpError)) throw e;
    return (
      <>
        <SiteHeader />
        <main className="wrap">
          <h1>Admin sign-in</h1>
          <AdminSignIn next="/admin/links" />
        </main>
      </>
    );
  }
  redirect("/admin/links");
}
