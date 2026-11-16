"use client";

import { ErrorState } from "@/components/states";

export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorState error={error} reset={reset} title="We couldn't load reviews" />;
}
