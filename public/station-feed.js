// The portal's stations, sensors and rain gauges. realtime.json (every station, all 178 columns, time stamps, elevation) is the only source;
// the compact shape the portal's logic reads is derived from it by station-records.js. Both the data branch (refreshed every few minutes)
// and the copy deployed with the site are read and the newer one is used (see observation-feed.js).
import {fetchFeed} from './observation-feed.js';
import {slimFromRealtime} from './station-records.js';

export async function fetchStationFeed(options = {}) {
  try {
    const realtime = await fetchFeed('realtime', options), slim = slimFromRealtime(realtime);
    if (!slim.stations.length) throw Error('No usable stations in realtime.json');
    return {...slim, feed_origin: realtime.feed_origin};
  } catch (error) {
    if (options.signal?.aborted) throw error;
    // Transitional only: until realtime.json has been published (data branch and site), the compact stations.json that the same sync writes
    // from the same login keeps the portal working. It is not a second source and is dropped once realtime.json is everywhere.
    return {...await fetchFeed('stations', options), legacy_fallback: true};
  }
}
