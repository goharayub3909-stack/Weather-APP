"""Discover station endpoints with an in-memory authenticated session.

Outputs paths and field names only. Never persist login responses, cookies,
credentials, query strings or HTML in Actions logs/artifacts.
"""
import http.cookiejar
import json
import os
import re
from urllib.parse import urlencode, urljoin, urlsplit
from urllib.request import build_opener, HTTPCookieProcessor, Request

origin = 'https://forecasting.weatherwalay.com'
username = os.environ.get('WEATHERWALAY_USERNAME')
password = os.environ.get('WEATHERWALAY_PASSWORD')
if not username or not password:
    raise SystemExit('Both repository secrets are required.')
opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
opener.open(origin + '/login', timeout=30).read()
response = opener.open(Request(origin + '/login', data=urlencode({'username': username, 'password': password}).encode()), timeout=30)
response.read()
response = opener.open(origin + '/realtime', timeout=30)
html = response.read().decode()
if urlsplit(response.url).path in ('/login', '/signin') or re.search(r'type=["\']password', html, re.I):
    raise SystemExit('Station login did not succeed. Check the repository secrets.')
documents = [html]
paths = set()
for path in re.findall(r'<script[^>]+src=["\']([^"\']+)', html):
    url = urljoin(origin, path)
    parsed = urlsplit(url)
    if parsed.hostname == 'forecasting.weatherwalay.com':
        paths.add(parsed.path)
        documents.append(opener.open(url, timeout=30).read().decode())
for doc in documents:
    for path in re.findall(r'["\']((?:https://forecasting\.weatherwalay\.com)?/(?:api|realtime|static)[^"\'\s]*)["\']', doc):
        paths.add(urlsplit(path).path)
print(json.dumps({'authenticated': True, 'paths': sorted(paths)}))
# Bootstrap tokens stay in this process; only station field structure is logged.
match = re.search(r'(?:window\.)?__WW_BOOT__\s*=\s*(\{[^;]+\})\s*;', html)
if not match:
    print(json.dumps({'bootstrap_found': False}))
else:
    boot = json.loads(match.group(1))
    endpoint = urljoin(origin, boot.get('endpoint', '/feed/current'))
    if urlsplit(endpoint).hostname != 'forecasting.weatherwalay.com':
        raise SystemExit('Unexpected station endpoint host')
    payload = json.load(opener.open(Request(endpoint, headers={'X-Requested-With':'XMLHttpRequest','X-WW-Token':boot.get('token','')}),timeout=30))
    perm = boot.get('perm', [])
    rows = payload.get('rows', [])
    if not perm or not rows: raise SystemExit('No station rows')
    row = [None]*len(perm)
    for i,index in enumerate(perm): row[index] = rows[0][i]
    columns=[]
    for i,value in enumerate(row):
        example = value if isinstance(value,(int,float)) else value if isinstance(value,str) and len(value)<80 and not re.search(r'[A-Fa-f0-9]{24,}',value) else None
        columns.append({'index':i,'type':type(value).__name__,'example':example})
    print(json.dumps({'count':len(rows),'columns':columns,'payload_keys':list(payload.keys())}))
