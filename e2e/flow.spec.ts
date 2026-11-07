import { expect, test, type Page } from "@playwright/test";

/** CLAUDE.md §10: Playwright e2e for connect → diagnosis → recs, on the fixtures sample org. */

/** page.goto, retried once: the dev server can abort a navigation while it compiles a route for the first time. */
async function visit(page: Page, url: string) {
  try {
    await page.goto(url);
  } catch (e) {
    if (!String(e).includes("ERR_ABORTED")) throw e;
    await page.waitForTimeout(2000);
    await page.goto(url);
  }
}

async function signIn(page: Page) {
  await visit(page, "/api/dev/login?next=/");
  await expect(page.getByRole("heading", { name: "Your organisations" })).toBeVisible();
}

async function firstOrgPath(page: Page): Promise<string> {
  const href = await page.locator("a.card-link").first().getAttribute("href");
  expect(href).toMatch(/^\/app\/[0-9a-f-]{36}$/);
  return href!;
}

test("connect → diagnosis → recommendations → stack map", async ({ page }) => {
  test.setTimeout(300_000); // the dev server compiles each route on its first visit
  await signIn(page);
  const org = await firstOrgPath(page);
  await expect(page.getByText("sample data").first()).toBeVisible();

  await visit(page, org);
  await expect(page.getByText("At stake")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Lines worth a look" })).toBeVisible();

  // Every recommendation links to its evidence: open the first flagged line.
  // Follow the link by its href: a click can land before the dev server has hydrated the page.
  const lineHref = await page.locator("a.card-link[href*='/lines/']").first().getAttribute("href");
  await visit(page, lineHref!);
  await expect(page.getByRole("heading", { name: "Why we flagged it" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Apps that fit" })).toBeVisible();
  await expect(page.getByText("Nobody can pay to rank higher")).toBeVisible();

  // After install: mark the top suggestion as started, then it's on the After install page with day 7/30/90.
  const firstRec = page.locator("ol.cards li").filter({ has: page.getByRole("button", { name: "We've started using it" }) }).first();
  const appName = (await firstRec.locator(".card-head b").first().innerText()).split("\n")[0]!.replace(/(you use this|draft entry)/g, "").trim();
  // Retry the click until the page has hydrated and the save message shows (dev server compiles on first visit).
  await expect(async () => {
    await firstRec.getByRole("button", { name: "We've started using it" }).click();
    await expect(page.getByText("We'll check it at day 7, 30 and 90")).toBeVisible({ timeout: 5000 });
  }).toPass({ timeout: 90_000 });
  await visit(page, `${org}/after`);
  await expect(page.getByRole("heading", { name: appName })).toBeVisible();
  await expect(page.getByText("Day 90")).toBeVisible();

  await visit(page, `${org}/settings`);
  await expect(page.getByText("Help other businesses compare prices")).toBeVisible();

  await visit(page, `${org}/map`);
  await expect(page.getByRole("heading", { name: "Stack map" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Fixes, in order" })).toBeVisible();
});

test("public apps directory and a dossier", async ({ page }) => {
  await visit(page, "/apps");
  await expect(page.getByRole("heading", { name: "Apps that work with Xero" })).toBeVisible();
  await visit(page, (await page.locator("a.dir-link").first().getAttribute("href"))!);
  await expect(page.getByRole("heading", { name: "Price" })).toBeVisible();
  await expect(page.getByText("What similar businesses pay")).toBeVisible();
});

/** CLAUDE.md §10 definition of done: works in both themes at 400px width (no sideways scrolling). */
for (const scheme of ["light", "dark"] as const) {
  test(`400px wide, ${scheme} theme: no page scrolls sideways`, async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 400, height: 860 }, colorScheme: scheme });
    const page = await ctx.newPage();
    await signIn(page);
    const org = await firstOrgPath(page);
    const lineHref = await (async () => {
      await visit(page, org);
      return page.locator("a.card-link[href*='/lines/']").first().getAttribute("href");
    })();
    const paths = ["/", org, `${org}/map`, `${org}/statements/pl`, `${org}/statements/bs`, `${org}/statements/cf`, lineHref!, `${org}/after`, `${org}/settings`, "/apps", "/apps/autoentry"];
    for (const p of paths) {
      await visit(page, p);
      await page.waitForLoadState("networkidle");
      const { scroll, client, bg, wide } = await page.evaluate(() => {
        const client = document.documentElement.clientWidth;
        // Name the deepest elements that stick out, so a failure says what to fix.
        const wide = [...document.body.querySelectorAll("*")]
          .filter((el) => el.getBoundingClientRect().right > client + 1 && ![...el.children].some((c) => c.getBoundingClientRect().right > client + 1))
          .slice(0, 5)
          .map((el) => `${el.tagName.toLowerCase()}.${(el as HTMLElement).className} "${(el.textContent ?? "").trim().slice(0, 30)}" →${Math.round(el.getBoundingClientRect().right)}px`);
        return { scroll: document.documentElement.scrollWidth, client, bg: getComputedStyle(document.body).backgroundColor, wide };
      });
      expect(scroll, `${p} scrolls sideways (${scroll}px > ${client}px): ${wide.join(" | ")}`).toBeLessThanOrEqual(client);
      // Dark theme really applies (body background is dark), light stays light.
      const [r, g, b] = bg.match(/\d+/g)!.map(Number);
      const lum = (0.2126 * r! + 0.7152 * g! + 0.0722 * b!) / 255;
      if (scheme === "dark") expect(lum, `${p} body not dark`).toBeLessThan(0.3);
      else expect(lum, `${p} body not light`).toBeGreaterThan(0.7);
      await page.screenshot({ path: `.e2e-results/400-${scheme}-${p.replace(/[^a-z0-9]+/gi, "_").slice(-40) || "home"}.png`, fullPage: true });
    }
    await ctx.close();
  });
}
