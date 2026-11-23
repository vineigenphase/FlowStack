#!/usr/bin/env python3
"""Read-only collection of public Xero App Store listing pages (apps.xero.com/uk/app/<slug>).

Owner decision (18 Nov 2026): collect listing facts fully from the public listing pages. robots.txt allows
/<region>/app/<slug> (it disallows only ssu-authoriser and search). One request per second, honest user agent.
Only the HTML page is read: the listing data the page itself embeds (appListingState.appListing). No internal
APIs, no sign-in, nothing written to Xero. Prices are NOT on the page (they load from an internal API we don't
call), so prices come from the reviewed workbook instead.

Writes, per run, to --out:
  raw/<slug>.json            the embedded listing object, verbatim (gitignored; re-parse without refetching)
  fetch_log.csv              slug, HTTP status, parsed?, checked_at
Resumable: a slug whose raw/<slug>.json exists is skipped unless --refetch.

Usage: python scripts/catalogue/fetch_xero_listings.py --apps data/xero-apps/handoff/csv/apps.csv \
         --out data/xero-apps/handoff/enrichment_run [--limit N] [--delay 1.0]
"""
import argparse, csv, datetime, json, os, time, urllib.error, urllib.request

UA = "FlowStack-catalogue-research/1.0 (read-only; contact via flowstack)"


def fetch(slug, region="uk"):
    url = f"https://apps.xero.com/{region}/app/{slug}"
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            html = r.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as e:
        return url, e.code, None
    except Exception as e:  # network error: record it, keep going
        return url, f"error:{type(e).__name__}", None
    i = html.find('{"appState"')
    j = html.find("</script>", i)
    if i < 0 or j < 0:
        return url, 200, None
    try:
        data = json.loads(html[i:j])
    except json.JSONDecodeError:
        return url, "bad-json", None
    page = data.get("pageState") or {}
    err = (page.get("error") or {}).get("status")
    listing = (data.get("appListingState") or {}).get("appListing")
    return url, (err or 200), listing


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--apps", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--delay", type=float, default=1.0)
    ap.add_argument("--limit", type=int, default=0)
    ap.add_argument("--refetch", action="store_true")
    a = ap.parse_args()
    raw = os.path.join(a.out, "raw")
    os.makedirs(raw, exist_ok=True)
    today = datetime.date.today().isoformat()
    rows = [r for r in csv.DictReader(open(a.apps, encoding="utf-8")) if (r.get("xero_listing_slug") or "").strip()]
    if a.limit:
        rows = rows[: a.limit]
    log_path = os.path.join(a.out, "fetch_log.csv")
    log = {}
    if os.path.exists(log_path):
        for r in csv.DictReader(open(log_path, encoding="utf-8")):
            log[r["slug"]] = r
    done = 0
    for n, r in enumerate(rows, 1):
        slug = r["xero_listing_slug"].strip()
        path = os.path.join(raw, slug + ".json")
        if os.path.exists(path) and not a.refetch:
            continue
        url, status, listing = fetch(slug)
        if listing:
            with open(path, "w", encoding="utf-8") as f:
                json.dump(listing, f, ensure_ascii=False)
        log[slug] = dict(app_id=r["app_id"], slug=slug, url=url, http_status=status, parsed=bool(listing), checked_at=today)
        done += 1
        if done % 25 == 0:
            print(f"{n}/{len(rows)}", flush=True)
            _write_log(log_path, log)
        time.sleep(a.delay)
    _write_log(log_path, log)
    ok = sum(1 for x in log.values() if str(x["parsed"]) in ("True", "TRUE"))
    print(f"done: {ok}/{len(log)} listings parsed; fetched {done} this run")


def _write_log(path, log):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=["app_id", "slug", "url", "http_status", "parsed", "checked_at"])
        w.writeheader()
        for v in log.values():
            w.writerow({**v, "parsed": "TRUE" if str(v["parsed"]) in ("True", "TRUE") else "FALSE"})


if __name__ == "__main__":
    main()
