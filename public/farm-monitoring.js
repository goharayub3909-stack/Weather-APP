// Pure geometry and raster-value helpers. Never infer missing pixels or scenes.
export const finite = (v) => typeof v === "number" && Number.isFinite(v);
export function pointInField(point, vertices) {
  let inside = false;
  const [y, x] = point;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const [yi, xi] = vertices[i],
      [yj, xj] = vertices[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const turn = (a, b, c) => (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]);
export function validField(v) {
  if (v.length < 3 || v.some((p) => p.length !== 2 || !p.every(finite) || Math.abs(p[0]) > 85 || Math.abs(p[1]) > 180)) return false;
  if (new Set(v.map((p) => p.join(","))).size !== v.length) return false;
  if (
    Math.abs(
      v.reduce((s, a, i) => {
        const b = v[(i + 1) % v.length];
        return s + a[1] * b[0] - b[1] * a[0];
      }, 0),
    ) < 1e-12
  )
    return false;
  const on = (a, b, p) =>
    Math.abs(turn(a, b, p)) < 1e-12 &&
    p[0] >= Math.min(a[0], b[0]) &&
    p[0] <= Math.max(a[0], b[0]) &&
    p[1] >= Math.min(a[1], b[1]) &&
    p[1] <= Math.max(a[1], b[1]);
  for (let i = 0; i < v.length; i++)
    for (let j = i + 1; j < v.length; j++) {
      if (j === i + 1 || (i === 0 && j === v.length - 1)) continue;
      const a = v[i],
        b = v[(i + 1) % v.length],
        c = v[j],
        d = v[(j + 1) % v.length];
      if ((turn(a, b, c) * turn(a, b, d) < 0 && turn(c, d, a) * turn(c, d, b) < 0) || on(a, b, c) || on(a, b, d) || on(c, d, a) || on(c, d, b))
        return false;
    }
  return true;
}
export function fieldSamplePoints(v) {
  if (!validField(v)) return [];
  const ys = v.map((p) => p[0]),
    xs = v.map((p) => p[1]),
    minY = Math.min(...ys),
    maxY = Math.max(...ys),
    minX = Math.min(...xs),
    maxX = Math.max(...xs),
    points = [];
  for (const [y, x] of [
    [0.5, 0.5],
    [0.25, 0.25],
    [0.25, 0.75],
    [0.75, 0.25],
    [0.75, 0.75],
    [0.5, 0.25],
    [0.5, 0.75],
    [0.25, 0.5],
    [0.75, 0.5],
  ]) {
    const p = [minY + (maxY - minY) * y, minX + (maxX - minX) * x];
    if (pointInField(p, v)) points.push(p);
    if (points.length === 5) break;
  }
  // A highly concave field can miss the regular sample lattice. Do not sample
  // an outside centroid or substitute a point on another field.
  return points;
}
export function rasterValue(data) {
  const values = data?.values;
  if (!Array.isArray(values)) return null;
  const flat = values.flat(Infinity);
  return flat.length === 1 && finite(flat[0]) ? flat[0] : null;
}
export function validPixel(sensor, value) {
  if (!finite(value) || !Number.isInteger(value)) return false;
  if (sensor === "sentinel") return [4, 5, 6].includes(value);
  if (sensor === "landsat") return value >= 0 && (value & 63) === 0;
  if (sensor === "modis-lst") return value >= 0 && (value & 255) === 0;
  return sensor === "modis" && value === 0;
}
export const qualityAsset = (sensor) =>
  ({ sentinel: "SCL", landsat: "qa_pixel", modis: "250m_16_days_pixel_reliability", "modis-lst": "QC_Day" })[sensor];
export function recentSceneDays(features, now = Date.now(), lookback = 90) {
  const start = now - lookback * 86400000,
    days = new Map();
  for (const f of [...features].sort((a, b) =>
    String(b.properties.datetime || b.properties.start_datetime).localeCompare(String(a.properties.datetime || a.properties.start_datetime)),
  )) {
    const stamp = f.properties.datetime || f.properties.start_datetime,
      time = Date.parse(stamp);
    if (!finite(time) || time < start || time > now) continue;
    const date = new Date(time).toLocaleDateString("en-CA", { timeZone: "Asia/Karachi" });
    if (!days.has(date)) days.set(date, f);
  }
  return [...days.entries()].sort(([a], [b]) => a.localeCompare(b));
}
export function historyNarrative(rows, { crop = null, stage = "mixed" } = {}, now = Date.now()) {
  const valid = rows.filter((r) => finite(r.value)).sort((a, b) => a.time - b.time);
  if (valid.length < 3 || valid.at(-1).time - valid[0].time < 14 * 86400000)
    return "Not enough clear observations yet to describe crop development. At least three clear passes spanning 14 days are needed. Missing days mean cloud or no pass, not poor crop health.";
  const fmt = (t) => new Date(t).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Asia/Karachi" });
  // The current crop is read from the last 60 days; the full year can include earlier crops or fallow.
  const recent = valid.filter((r) => r.time >= now - 60 * 86400000),
    window = recent.length >= 2 ? recent : valid.slice(-3),
    first = window[0].value,
    last = window.at(-1).value,
    peakRow = valid.reduce((a, b) => (b.value > a.value ? b : a)),
    recentPeak = Math.max(...window.map((r) => r.value)),
    change = last - first,
    name = crop?.name || "this field";
  const intro = `Latest ${last.toFixed(2)} on ${fmt(window.at(-1).time)}; ${change >= 0 ? "up" : "down"} ${Math.abs(change).toFixed(2)} since ${fmt(window[0].time)}. 12-month peak ${peakRow.value.toFixed(2)} on ${fmt(peakRow.time)}. `;
  const pattern =
    first < 0.25 && last >= 0.4 && change >= 0.15
      ? "Green cover is building, consistent with emergence and canopy growth."
      : recentPeak >= 0.45 && last < 0.25 && recentPeak - last >= 0.25
        ? "Green cover has dropped sharply, consistent with harvest or field clearing. Stress or a crop change can look similar."
        : change <= -0.15
          ? "Greenness is falling. Check for normal maturity, water stress, pests or disease before deciding the cause."
          : last >= 0.55
            ? "Dense green canopy. This shows good cover, not freedom from disease or a yield level."
            : last < 0.2
              ? "Little green cover: the field may be unsown, recently harvested or bare."
              : "Cover is steady or changing slowly. Compare with what you expect for this stage and walk the field.";
  // Before or at sowing, the field still holds the previous crop or stubble.
  const early = ["pre-sowing", "sowing"].includes(stage),
    falling = change <= -0.15 || (recentPeak >= 0.45 && last < 0.25 && recentPeak - last >= 0.25);
  const context = early && falling
    ? ` At ${name} sowing time, this most likely shows the previous season's crop maturing or being harvested, not a problem with ${name}.`
    : early && last < 0.25
      ? ` Low cover is expected before ${name} emerges.`
      : "";
  return intro + pattern + context + ` Read for ${name} at stage: ${stage}. Satellite indices cannot confirm sowing, harvest or growth stage on their own.`;
}
export function renderFieldChart(
  root,
  rows,
  { title = "Satellite acquisitions", unit = "", start = Date.now() - 365 * 86400000, end = Date.now(), color = "#92d494", events = [] } = {},
) {
  root.replaceChildren();
  const valid = rows.filter((r) => finite(r.value) && finite(r.time)).sort((a, b) => a.time - b.time),
    heading = document.createElement("h4");
  heading.textContent = title;
  root.append(heading);
  if (!valid.length) {
    const p = document.createElement("p");
    p.textContent = "No usable readings in this period. Gaps are not filled.";
    root.append(p);
    return;
  }
  const ns = "http://www.w3.org/2000/svg",
    svg = document.createElementNS(ns, "svg"),
    w = 720,
    h = 240,
    p = { l: 54, r: 22, t: 22, b: 38 },
    lo = Math.min(...valid.map((r) => (finite(r.min) ? r.min : r.value))),
    hi = Math.max(...valid.map((r) => (finite(r.max) ? r.max : r.value)), lo + 0.1),
    pad = (hi - lo) * 0.12,
    min = lo - pad,
    max = hi + pad,
    x = (t) => p.l + ((t - start) / (end - start)) * (w - p.l - p.r),
    y = (v) => h - p.b - ((v - min) / (max - min)) * (h - p.t - p.b);
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`);
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", title + ". Dots are actual available readings, gaps are unavailable data.");
  const add = (tag, attrs, text) => {
    const e = document.createElementNS(ns, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (text !== undefined) e.textContent = text;
    svg.append(e);
    return e;
  };
  for (let i = 0; i < 4; i++) {
    const v = min + ((max - min) * i) / 3;
    add("line", { x1: p.l, x2: w - p.r, y1: y(v), y2: y(v), stroke: "currentColor", opacity: 0.12 });
    add("text", { x: p.l - 8, y: y(v) + 4, "text-anchor": "end", fill: "currentColor", "font-size": 12 }, (Math.abs(v) < 0.005 ? 0 : v).toFixed(2));
  }
  for (let i = 0; i < 4; i++) {
    const t = start + ((end - start) * i) / 3;
    add(
      "text",
      { x: x(t), y: h - 10, "text-anchor": "middle", fill: "currentColor", "font-size": 12 },
      new Date(t).toLocaleDateString("en-GB", { timeZone: "Asia/Karachi", day: "numeric", month: "short" }),
    );
  }
  for (const [i, r] of valid.entries()) {
    if (finite(r.min) && finite(r.max)) {
      add("line", { x1: x(r.time), x2: x(r.time), y1: y(r.min), y2: y(r.max), stroke: color, "stroke-width": 6, opacity: 0.35 });
    }
    const previous = valid[i - 1];
    if (previous && r.time - previous.time <= 20 * 86400000)
      add("line", {
        x1: x(previous.time),
        y1: y(previous.value),
        x2: x(r.time),
        y2: y(r.value),
        stroke: color,
        "stroke-width": 2,
        "stroke-dasharray": "5 5",
        opacity: 0.7,
      });
    const dot = add("circle", { cx: x(r.time), cy: y(r.value), r: 4, fill: color, stroke: "currentColor", "stroke-width": 0.5 }),
      tip = document.createElementNS(ns, "title");
    tip.textContent =
      new Date(r.time).toLocaleString("en-GB", { timeZone: "Asia/Karachi" }) +
      " PKT: " +
      r.value.toFixed(3) +
      " " +
      unit +
      (finite(r.clear) ? " · " + Math.round(r.clear * 100) + "% of field clear" : r.count ? " · " + r.count + " usable sample positions" : "");
    dot.append(tip);
  }
  // Field events (sowing, logged activities) as labelled dashed lines.
  for (const ev of events) {
    if (!finite(ev.time) || ev.time < start || ev.time > end) continue;
    const ex = x(ev.time), tone = ev.color || "#e4bc60";
    add("line", { x1: ex, x2: ex, y1: p.t, y2: h - p.b, stroke: tone, "stroke-dasharray": "3 3", opacity: 0.85 });
    add("text", { x: ex + 3, y: p.t + 10, fill: tone, "font-size": 10 }, ev.label);
  }
  root.append(svg);
  const note = document.createElement("small");
  note.textContent =
    unit +
    (valid.some((r) => finite(r.min) && finite(r.max))
      ? " · dots = sample mean; vertical bars = sample min–max."
      : " · dots = actual available readings.") +
    " Dashed lines connect observations and do not supply missing daily values.";
  root.append(note);
}
export function thermalMoistureIndex(temperature, wet, dry) {
  if (![temperature, wet, dry].every(finite) || temperature < -80 || temperature > 100 || wet < -30 || dry > 80 || dry - wet < 5) return null;
  return Math.max(0, Math.min(1, (dry - temperature) / (dry - wet)));
}
// Relative vigour comparisons use actual quality-screened positions, not a
// percentage of field area or a productivity / yield measurement.
export function vegetationSamples(samples, { stage = "mixed" } = {}) {
  const valid = samples.filter((s) => finite(s.value)),
    values = valid.map((s) => s.value).sort((a, b) => a - b);
  if (valid.length < 3 || valid.length < samples.length * 0.6)
    return { ready: false, note: "Too few clear sample positions to compare this field.", samples: [] };
  const min = values[0],
    max = values.at(-1),
    mean = values.reduce((a, b) => a + b, 0) / values.length,
    spread = max - min;
  const labelled = valid.map((s) => ({
    ...s,
    zone:
      s.value < 0.2
        ? "Low / non-vegetated signal"
        : spread < 0.1
          ? "Similar green-cover signal"
          : s.value <= min + spread * 0.25
            ? "Lower relative vigour"
            : s.value >= max - spread * 0.25
              ? "Higher relative vigour"
              : "Typical relative vigour",
  }));
  return {
    ready: true,
    min,
    max,
    mean,
    vegetated: values.filter((v) => v >= 0.2).length,
    count: valid.length,
    samples: labelled,
    note:
      valid.length +
      " clear sample positions; " +
      values.filter((v) => v >= 0.2).length +
      " have NDVI ≥0.2. This is a sample indicator, not field-area coverage. " +
      (["pre-sowing", "sowing", "harvest"].includes(stage) ? "Low cover can fit the selected stage. " : "") +
      "Higher vigour is only a potential-productivity proxy. Compare weak and strong spots by scouting and paired soil / leaf tests; check irrigation uniformity or drainage before treating. No cause or yield is diagnosed.",
  };
}
