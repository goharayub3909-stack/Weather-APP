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
  { title = "Satellite acquisitions", unit = "", start = Date.now() - 365 * 86400000, end = Date.now(), color = "#92d494", events = [], marker = null, onPick = null } = {},
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
  if ((end - start) / 86400000 > 120) {
    // Month labels for a year-long record.
    const first = new Date(start);
    for (let t = Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1); t <= end; ) {
      const d = new Date(t);
      add("line", { x1: x(t), x2: x(t), y1: p.t, y2: h - p.b, stroke: "currentColor", opacity: 0.07 });
      add("text", { x: x(t), y: h - 10, "text-anchor": "middle", fill: "currentColor", "font-size": 11 }, d.toLocaleDateString("en-GB", { timeZone: "UTC", month: "short" }) + (d.getUTCMonth() === 0 ? " " + d.getUTCFullYear() : ""));
      t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
    }
  } else
    for (let i = 0; i < 4; i++) {
      const t = start + ((end - start) * i) / 3;
      add("text", { x: x(t), y: h - 10, "text-anchor": "middle", fill: "currentColor", "font-size": 12 }, new Date(t).toLocaleDateString("en-GB", { timeZone: "Asia/Karachi", day: "numeric", month: "short" }));
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
    if (onPick) {
      // Larger invisible target so a fingertip can hit a dot; keyboard users can Tab to it.
      const hit = add("circle", { cx: x(r.time), cy: y(r.value), r: 11, fill: "transparent", tabindex: 0, role: "button", style: "cursor:pointer", "aria-label": "Show the satellite image from " + new Date(r.time).toLocaleDateString("en-GB", { timeZone: "Asia/Karachi", day: "numeric", month: "long" }) + ", value " + r.value.toFixed(2) });
      hit.append(tip.cloneNode(true));
      hit.addEventListener("click", () => onPick(r));
      hit.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(r); } });
    }
  }
  // Date shown on the map right now.
  if (finite(marker) && marker >= start && marker <= end) {
    add("line", { x1: x(marker), x2: x(marker), y1: p.t, y2: h - p.b, stroke: "#8ad9ff", "stroke-width": 2, opacity: 0.95 });
    add("path", { d: `M${x(marker) - 5},${p.t - 8} L${x(marker) + 5},${p.t - 8} L${x(marker)},${p.t} Z`, fill: "#8ad9ff" });
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
/** Mean value per month (Pakistan time) from clear passes, in calendar order. */
export function monthlyMeans(rows, start = -Infinity, end = Infinity) {
  const groups = new Map();
  for (const r of rows) {
    if (!finite(r.value) || !finite(r.time) || r.time < start || r.time > end) continue;
    const key = new Date(r.time + 5 * 3600000).toISOString().slice(0, 7), g = groups.get(key) || { key, sum: 0, n: 0 };
    g.sum += r.value; g.n++; groups.set(key, g);
  }
  return [...groups.values()].sort((a, b) => a.key.localeCompare(b.key)).map((g) => ({ key: g.key, mean: g.sum / g.n, n: g.n }));
}
export function renderMonthlyChart(root, rows, { title = "Monthly average", unit = "", color = "#92d494", start = Date.now() - 365 * 86400000, end = Date.now() } = {}) {
  root.replaceChildren();
  const months = monthlyMeans(rows, start, end), heading = document.createElement("h4");
  heading.textContent = title;
  root.append(heading);
  if (!months.length) { const p = document.createElement("p"); p.textContent = "No clear months yet."; root.append(p); return; }
  const byKey = new Map(months.map((m) => [m.key, m])), seq = [];
  for (let t = Date.UTC(new Date(start).getUTCFullYear(), new Date(start).getUTCMonth(), 1); t <= end; ) {
    const d = new Date(t); seq.push({ key: d.toISOString().slice(0, 7), label: d.toLocaleDateString("en-GB", { timeZone: "UTC", month: "short" }) });
    t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
  }
  const ns = "http://www.w3.org/2000/svg", svg = document.createElementNS(ns, "svg"), w = 720, h = 170, pad = { l: 54, r: 22, t: 20, b: 28 },
    vals = months.map((m) => m.mean), lo = Math.min(0, ...vals), hi = Math.max(...vals, lo + 0.1) * 1.12,
    y = (v) => h - pad.b - ((v - lo) / (hi - lo)) * (h - pad.t - pad.b), bw = (w - pad.l - pad.r) / seq.length;
  svg.setAttribute("viewBox", `0 0 ${w} ${h}`); svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", title + ". One bar per month; empty months had no clear satellite pass.");
  const add = (tag, attrs, text) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (text !== undefined) e.textContent = text; svg.append(e); return e; };
  add("line", { x1: pad.l, x2: w - pad.r, y1: y(0), y2: y(0), stroke: "currentColor", opacity: 0.25 });
  add("text", { x: pad.l - 8, y: y(hi) + 10, "text-anchor": "end", fill: "currentColor", "font-size": 11 }, hi.toFixed(2));
  add("text", { x: pad.l - 8, y: y(0) + 4, "text-anchor": "end", fill: "currentColor", "font-size": 11 }, "0");
  seq.forEach((m, i) => {
    const x0 = pad.l + i * bw, g = byKey.get(m.key);
    add("text", { x: x0 + bw / 2, y: h - 9, "text-anchor": "middle", fill: "currentColor", "font-size": 11, opacity: 0.8 }, m.label);
    if (!g) { add("text", { x: x0 + bw / 2, y: y(0) - 6, "text-anchor": "middle", fill: "currentColor", "font-size": 10, opacity: 0.5 }, "–"); return; }
    const top = Math.min(y(g.mean), y(0)), bar = add("rect", { x: x0 + bw * 0.16, y: top, width: bw * 0.68, height: Math.max(1, Math.abs(y(g.mean) - y(0))), fill: color, opacity: 0.8, rx: 2 });
    const tip = document.createElementNS(ns, "title"); tip.textContent = m.label + ": mean " + g.mean.toFixed(2) + " " + unit + " from " + g.n + " clear pass" + (g.n === 1 ? "" : "es"); bar.append(tip);
    add("text", { x: x0 + bw / 2, y: top - 4, "text-anchor": "middle", fill: "currentColor", "font-size": 10 }, g.mean.toFixed(2));
  });
  root.append(svg);
  const note = document.createElement("small"); note.textContent = "Average of the clear passes in each month; “–” means no clear pass."; root.append(note);
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
