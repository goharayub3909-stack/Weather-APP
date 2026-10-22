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
