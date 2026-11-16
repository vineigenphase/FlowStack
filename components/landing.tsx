import Link from "next/link";
import { SalaryCalculator } from "./salary-calculator";
import { WaitlistForm } from "./waitlist-form";

/**
 * Only stats with a source the visitor can open (NEXT-STEPS P1.11). Add a row only with a first-party link and the
 * date it was checked; never round up or extrapolate.
 */
export const STATS = [
  {
    text: "More than 1,000 apps are certified in the Xero App Store.",
    source: "Xero media release, August 2026",
    url: "https://www.xero.com/us/media-releases/new-ai-innovations-xerocon-denver/",
    checked: "2026-11-16",
  },
] as const;

/**
 * Public landing (UI-SPEC §5.1, NEXT-STEPS P1.11): content and structure only, in the existing plain styles,
 * until the designer's version (no visual redesign before their feedback).
 */
export function Landing({ demo, signIn }: { demo: boolean; signIn: { href: string; dev: boolean } }) {
  return (
    <>
      <h1 className="display">The right Xero apps for your business, from your own books</h1>
      <p className="lede">
        FlowStack reads your Xero reports and supplier totals, shows where the figures point to manual work, and puts every fact you need to choose an
        app on one page. No app pays to appear.
      </p>
      <p className="actions">
        <a className="btn" href="#waitlist">
          Join the waitlist
        </a>
        {demo ? (
          <Link className="btn ghost" href="/demo">
            See a sample
          </Link>
        ) : null}
      </p>

      <section className="panel" aria-labelledby="promise">
        <h2 id="promise">Read-only, always</h2>
        <p>We read your reports, chart of accounts and supplier totals.</p>
        <p>We never:</p>
        <ul className="plain">
          <li>Write to your books.</li>
          <li>Store individual transactions.</li>
          <li>Train AI on your data.</li>
          <li>Sell your data.</li>
        </ul>
      </section>

      <section aria-labelledby="calc">
        <h2 id="calc">Time is salary</h2>
        <p className="muted">Choosing an app means vendor sites, demos and pricing calls. Here is what that time costs.</p>
        <SalaryCalculator />
      </section>

      <section aria-labelledby="how">
        <h2 id="how">How it works</h2>
        <ol className="plain">
          <li>
            <b>Connect Xero.</b> Read-only, one business at a time; accountants add each client the same way.
          </li>
          <li>
            <b>See your flags with the evidence.</b> Each one links to the figures in your own books that raised it.
          </li>
          <li>
            <b>Choose apps with every fact in one place.</b> Published prices with their source and date, what works with the apps you keep, and what
            posts to Xero.
          </li>
        </ol>
      </section>

      <section aria-labelledby="stats">
        <h2 id="stats">Worth knowing</h2>
        <ul className="plain">
          {STATS.map((s) => (
            <li key={s.url}>
              {s.text}{" "}
              <a className="muted small" href={s.url} target="_blank" rel="noopener noreferrer">
                Source: {s.source}
              </a>
            </li>
          ))}
        </ul>
      </section>

      <section id="waitlist" aria-labelledby="wl">
        <h2 id="wl">Join the waitlist</h2>
        <p className="muted">We&apos;re testing with a few finance teams first. Leave your details and we&apos;ll be in touch.</p>
        <WaitlistForm />
      </section>

      <p className="muted small">
        Already invited?{" "}
        <a href={signIn.dev ? signIn.href : "/connect"}>{signIn.dev ? "Sign in (local sample data)" : "Connect Xero"}</a>
      </p>
    </>
  );
}
