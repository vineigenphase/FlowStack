"use client";

/**
 * Plain, design-neutral loading and error states (NEXT-STEPS P0.4). The designer will propose the real ones;
 * keep these simple so they're easy to replace.
 */
import { useEffect } from "react";

export function PageSkeleton({ rows = 6, label = "Loading" }: { rows?: number; label?: string }) {
  return (
    <section aria-busy="true" aria-label={label}>
      <div className="skeleton" style={{ width: "40%", height: "1.6em" }} />
      <div className="skeleton block" />
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton" style={{ width: `${90 - ((i * 13) % 40)}%` }} />
      ))}
      <p className="sr-only">{label}…</p>
    </section>
  );
}

/**
 * What a route's error.tsx shows: the message, Retry (re-renders the segment) and a reference. For a server error
 * Next hides the message in production and gives a digest, which is what our logs carry.
 */
export function ErrorState({ error, reset, title = "Something went wrong" }: { error: Error & { digest?: string }; reset: () => void; title?: string }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  const generic = !error.message || /server components render|digest/i.test(error.message);
  return (
    <section role="alert" className="panel">
      <h2>{title}</h2>
      <p>{generic ? "We couldn't load this page. Try again in a moment." : error.message}</p>
      <button type="button" className="btn" onClick={() => reset()}>
        Retry
      </button>
      {error.digest ? <p className="request-id">Reference: {error.digest}</p> : null}
    </section>
  );
}
