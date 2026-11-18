#!/usr/bin/env python3
"""Read-only enrichment of the FlowStack app catalogue from public Xero App Store listings.

For every app in apps.csv that has a xero_listing_slug, fetch https://apps.xero.com/uk/app/<slug>,
read the listing data embedded in the page (appListingState.appListing) and write:
  app_regions.csv, app_languages.csv, app_store_functions.csv, app_listing_industries.csv,
  integration_dataflows.csv, app_listing_facts.csv (listed date, free trial, current rating/reviews),
  fetch_log.csv (status per slug).
Nothing is written to Xero. Standard library only. Check Xero's website terms before running; keep the
default delay (1 request/second). Output goes to a new folder; existing handoff CSVs are not overwritten.

Usage: python fetch_xero_listing_metadata.py --apps ../csv/apps.csv --out ../enrichment_run
"""
import argparse, csv, json, time, urllib.request, urllib.error, datetime, os

FLOW = {'in': 'app sends data into Xero (per listing)', 'out': 'app reads data from Xero (per listing)', 'exchange': 'two-way (per listing)'}


def fetch(slug, region='uk'):
    url = f'https://apps.xero.com/{region}/app/{slug}'
    req = urllib.request.Request(url, headers={'User-Agent': 'FlowStack-catalogue-research/1.0 (read-only)'})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            html = r.read().decode('utf-8', 'replace')
    except urllib.error.HTTPError as e:
        return url, e.code, None
    i = html.find('{"appState"')
    j = html.find('</script>', i)
    if i < 0 or j < 0:
        return url, 200, None
    data = json.loads(html[i:j])
    return url, 200, data.get('appListingState', {}).get('appListing')


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--apps', required=True)
    ap.add_argument('--out', required=True)
    ap.add_argument('--delay', type=float, default=1.0)
    ap.add_argument('--limit', type=int, default=0)
    a = ap.parse_args()
    os.makedirs(a.out, exist_ok=True)
    today = datetime.date.today().isoformat()
    rows = [r for r in csv.DictReader(open(a.apps, encoding='utf-8')) if r.get('xero_listing_slug')]
    if a.limit:
        rows = rows[:a.limit]
    out = {k: [] for k in ['regions', 'languages', 'functions', 'industries', 'dataflows', 'facts', 'log']}
    for n, r in enumerate(rows, 1):
        url, status, L = fetch(r['xero_listing_slug'])
        out['log'].append(dict(app_id=r['app_id'], slug=r['xero_listing_slug'], url=url, http_status=status,
                               parsed=bool(L), checked_at=today))
        if L:
            aid = r['app_id']
            base = dict(evidence_status='source-reported', source_url=url, checked_at=today)
            listed = {x.get('countryCode') for x in (L.get('regions') or [])}
            supported = {x.get('countryCode') for x in (L.get('supportedRegions') or [])}
            names = {x.get('countryCode'): x.get('name') for x in (L.get('regions') or []) + (L.get('supportedRegions') or [])}
            for c in sorted(listed | supported):
                out['regions'].append(dict(app_id=aid, region_code=c, region_name=names.get(c), in_listing_regions=c in listed,
                                           in_supported_regions=c in supported, **base))
            for l in L.get('languages') or []:
                out['languages'].append(dict(app_id=aid, language_code=l.get('localeIdentifier'), language_name=l.get('name'), **base))
            for f in L.get('functions') or []:
                out['functions'].append(dict(app_id=aid, xero_store_function_id=f.get('id'), xero_store_function_name=f.get('name'),
                                             kind='app-store category (not a verified capability)', **base))
            for f in L.get('industries') or []:
                out['industries'].append(dict(app_id=aid, xero_industry_id=f.get('id'), xero_industry_name=f.get('name'), **base))
            for d in L.get('dataFlow') or []:
                out['dataflows'].append(dict(app_id=aid, xero_object=d.get('name'), xero_object_id=d.get('id'), flow_raw=d.get('flow'),
                                             flow_meaning=FLOW.get(d.get('flow'), 'unknown'), **base))
            ft = next((k for k in (L.get('keyInformation') or []) if k.get('type') == 'FREE_TRIAL'), None)
            out['facts'].append(dict(app_id=aid, listed_date=(L.get('listedDate') or '')[:10] or None,
                                     listed_date_precision='day' if L.get('listedDate') else None,
                                     free_trial_flag=L.get('hasFreeTrial'), free_trial_days=ft.get('mainPointData') if ft else None,
                                     xero_rating_listing_now=L.get('rating'), xero_reviews_listing_now=L.get('reviewCount'), **base))
        if n % 25 == 0:
            print(f'{n}/{len(rows)}')
        time.sleep(a.delay)
    files = dict(regions='app_regions.csv', languages='app_languages.csv', functions='app_store_functions.csv',
                 industries='app_listing_industries.csv', dataflows='integration_dataflows.csv', facts='app_listing_facts.csv', log='fetch_log.csv')
    for k, fn in files.items():
        rs = out[k]
        if not rs:
            continue
        with open(os.path.join(a.out, fn), 'w', newline='', encoding='utf-8') as f:
            w = csv.DictWriter(f, fieldnames=list(rs[0].keys()))
            w.writeheader()
            for r in rs:
                w.writerow({k: ('TRUE' if v is True else 'FALSE' if v is False else ('' if v is None else v)) for k, v in r.items()})
    ok = sum(1 for x in out['log'] if x['parsed'])
    print(f'done: {ok}/{len(rows)} listings parsed; outputs in {a.out}')


if __name__ == '__main__':
    main()
