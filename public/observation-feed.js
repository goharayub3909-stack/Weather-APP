// Live observation feed (WeatherWalay stations and airport METARs).
// The data workflow republishes stations.json and metar.json to the `data` branch every few minutes,
// while the copy shipped with the site only changes when the whole site is redeployed and can be hours
// old. Read both and use whichever was retrieved more recently; either one alone still works.
export const FEED_REMOTE = 'https://raw.githubusercontent.com/goharayub3909-stack/Weather-APP/data/observation-data/';

const valid = feed => !!feed && Array.isArray(feed.stations);
export const feedTime = feed => Date.parse(feed?.retrieved_at);

export function newerFeed(a, b) {
  if (!valid(a)) return valid(b) ? b : null;
  if (!valid(b)) return a;
  const ta = feedTime(a), tb = feedTime(b);
  if (Number.isFinite(tb) && (!Number.isFinite(ta) || tb > ta)) return b;
  return a;
}

export async function fetchFeed(name, {signal, fetcher = fetch, site, remote = FEED_REMOTE + name + '.json'} = {}) {
  site ??= new URL('./observation-data/' + name + '.json', import.meta.url);
  const get = async (url, ms, cache) => {
    const r = await fetcher(url, {cache, signal: AbortSignal.any([...(signal ? [signal] : []), AbortSignal.timeout(ms)])});
    if (!r.ok) throw Error('Observation feed HTTP ' + r.status);
    return r.json();
  };
  const [live, local] = await Promise.allSettled([get(remote, 9000, 'default'), get(site, 18000, 'no-store')]);
  const liveFeed = live.status === 'fulfilled' ? live.value : null, siteFeed = local.status === 'fulfilled' ? local.value : null;
  const best = newerFeed(liveFeed, siteFeed);
  if (!best) throw Error('Observation feed unavailable');
  return {...best, feed_origin: best === liveFeed ? 'live' : 'site'};
}
