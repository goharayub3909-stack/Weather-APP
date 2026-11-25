import test from 'node:test';
import assert from 'node:assert/strict';
import {newerFeed, fetchFeed, feedTime} from '../public/observation-feed.js';

const feed = (retrieved_at, extra = {}) => ({retrieved_at, stations: [{id: 'a'}], ...extra});
const reply = body => async () => ({ok: true, json: async () => body});
const fail = status => async () => ({ok: false, status});
const stub = (live, site) => async url => String(url).includes('raw.githubusercontent.com') ? live(url) : site(url);

test('newerFeed keeps whichever feed was retrieved later', () => {
  const old = feed('2026-10-28T05:50:00Z'), fresh = feed('2026-10-28T12:10:00Z');
  assert.equal(newerFeed(old, fresh), fresh);
  assert.equal(newerFeed(fresh, old), fresh);
  assert.equal(newerFeed(fresh, fresh), fresh);                          // a tie keeps the first
  assert.equal(feedTime(fresh), Date.parse('2026-10-28T12:10:00Z'));
});

test('newerFeed ignores missing, malformed and undated feeds', () => {
  const good = feed('2026-10-28T05:50:00Z');
  assert.equal(newerFeed(null, good), good);
  assert.equal(newerFeed(good, null), good);
  assert.equal(newerFeed({stations: 'x'}, good), good);                  // not an array
  assert.equal(newerFeed(good, {stations: []}), good);                   // no retrieved_at: never beats a dated feed
  assert.equal(newerFeed(null, null), null);
});

test('fetchFeed returns the live branch copy when it is newer', async () => {
  const live = feed('2026-10-28T12:10:00Z'), site = feed('2026-10-28T05:50:00Z');
  const got = await fetchFeed('stations', {fetcher: stub(reply(live), reply(site)), site: 'http://site/stations.json'});
  assert.equal(got.retrieved_at, live.retrieved_at);
  assert.equal(got.feed_origin, 'live');
});

test('fetchFeed falls back to the deployed copy and fails only when both are unavailable', async () => {
  const site = feed('2026-10-28T05:50:00Z');
  const fromSite = await fetchFeed('metar', {fetcher: stub(fail(404), reply(site)), site: 'http://site/metar.json'});
  assert.equal(fromSite.feed_origin, 'site');
  const newerSite = await fetchFeed('metar', {fetcher: stub(reply(feed('2026-10-27T00:00:00Z')), reply(site)), site: 'http://site/metar.json'});
  assert.equal(newerSite.feed_origin, 'site');                           // a stale branch copy never overrides a newer deploy
  const onlyLive = await fetchFeed('metar', {fetcher: stub(reply(site), fail(500)), site: 'http://site/metar.json'});
  assert.equal(onlyLive.feed_origin, 'live');
  await assert.rejects(fetchFeed('metar', {fetcher: stub(fail(404), fail(500)), site: 'http://site/metar.json'}), /unavailable/);
  await assert.rejects(fetchFeed('metar', {fetcher: stub(async () => { throw Error('network'); }, async () => ({ok: true, json: async () => ({stations: 'bad'})})), site: 'http://site/metar.json'}), /unavailable/);
});
