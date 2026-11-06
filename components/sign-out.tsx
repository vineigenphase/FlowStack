"use client";

import { useRouter } from "next/navigation";

export function SignOut() {
  const router = useRouter();
  async function out() {
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    router.push("/");
    router.refresh();
  }
  return (
    <button type="button" className="link-btn" onClick={out}>
      Sign out
    </button>
  );
}
