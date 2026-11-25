import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {VIEW_IDS, HEADINGS, viewFor, anchorFor} from '../public/views.js';

test('every link opens exactly one view', () => {
  assert.equal(viewFor('#overview'), 'weather-view');
  assert.equal(viewFor(''), 'weather-view');
  assert.equal(viewFor('#unknown'), 'weather-view');
  assert.equal(viewFor('#hourly'), 'weather-view');
  assert.equal(viewFor('#details'), 'weather-view');
  assert.equal(viewFor('#maps'), 'maps-view');
  assert.equal(viewFor('#health'), 'health-view');
  assert.equal(viewFor('#climate'), 'climate-view');
  assert.equal(viewFor('#flood'), 'flood-view');
  assert.equal(viewFor('#farmers'), 'farmers-view');
  assert.equal(viewFor(undefined), 'weather-view');
});

test('only hourly and details scroll inside the Weather view', () => {
  assert.equal(anchorFor('#hourly'), 'hourly');
  assert.equal(anchorFor('#details'), 'details');
  for (const hash of ['#overview', '#maps', '#health', '#climate', '#flood', '#farmers', '', undefined]) assert.equal(anchorFor(hash), null);
});

test('each view has a heading and a matching container in the page', () => {
  const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
  for (const id of VIEW_IDS) {
    assert.ok(HEADINGS[id] && HEADINGS[id].length === 2, id + ' heading');
    assert.equal(html.split(`id="${id}"`).length - 1, 1, id + ' appears once');
  }
  // Health, Climate and Maps live in their own containers, not inside the Weather view.
  const weather = html.slice(html.indexOf('id="weather-view"'), html.indexOf('id="health-view"'));
  for (const id of ['health', 'climate', 'flood', 'maps', 'observations', 'satellite']) assert.ok(!weather.includes(`id="${id}"`), id + ' is not in the Weather view');
  for (const [view, inner] of [['health-view', 'health'], ['climate-view', 'climate'], ['flood-view', 'flood'], ['maps-view', 'maps']]) {
    const start = html.indexOf(`id="${view}"`), body = html.slice(start, html.indexOf('</div>', html.indexOf(`id="${inner}"`)));
    assert.ok(start > 0 && body.includes(`id="${inner}"`), inner + ' is inside ' + view);
  }
  const rail = html.slice(html.indexOf('class="view-switch"'), html.indexOf('</nav>', html.indexOf('class="view-switch"')));
  for (const hash of ['#overview', '#maps', '#health', '#climate', '#flood', '#farmers']) assert.ok(rail.includes(`href="${hash}"`), hash + ' in the section switch');
  assert.equal((html.match(/<div/g) || []).length, (html.match(/<\/div>/g) || []).length);
});
