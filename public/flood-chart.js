// Small interactive SVG chart used by FloodAI: bars, lines, areas and points on a left (and optional right)
// axis, a hover crosshair with a tooltip listing every series, and click-to-pick on the x axis.
const NS = 'http://www.w3.org/2000/svg', finite = v => typeof v === 'number' && Number.isFinite(v);
const svg = (tag, attrs = {}) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); return e; };
export function niceTicks(lo, hi, count = 5) {
  if (!(hi > lo)) return [lo];
  const raw = (hi - lo) / count, mag = 10 ** Math.floor(Math.log10(raw)), step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => s >= raw) || 10 * mag;
  const out = [];
  for (let v = Math.ceil(lo / step - 1e-9) * step; v <= hi + step * 1e-9; v += step) out.push(Math.round(v / step * 1e6) / 1e6 * step);
  return out;
}
export const extent = (values, pad = 0.05, floor = null) => {
  const v = values.filter(finite);
  if (!v.length) return [0, 1];
  let lo = Math.min(...v), hi = Math.max(...v);
  if (floor !== null) lo = Math.min(lo, floor);
  if (hi === lo) hi = lo + 1;
  return [lo, hi + (hi - lo) * pad];
};

// opts: {height, xDomain, xLog, yDomain, y2Domain, xFmt, yFmt, y2Fmt, yTitle, y2Title, series, vlines, onPick, label}
// series: {name, color, type: 'bar'|'line'|'area'|'points', data: [[x, y]], axis: 'y'|'y2', dash, barWidth, fmt}
export function drawChart(opts) {
  const W = 640, H = opts.height || 230, m = {l: 46, r: opts.y2Domain ? 46 : 14, t: 12, b: 30}, iw = W - m.l - m.r, ih = H - m.t - m.b;
  const [x0, x1] = opts.xDomain, lx = v => Math.log(Math.max(v, 1e-9));
  const sx = v => m.l + (opts.xLog ? (lx(v) - lx(x0)) / (lx(x1) - lx(x0)) : (v - x0) / (x1 - x0)) * iw;
  const ix = px => { const t = (px - m.l) / iw; return opts.xLog ? Math.exp(lx(x0) + t * (lx(x1) - lx(x0))) : x0 + t * (x1 - x0); };
  const yScale = ([lo, hi]) => v => m.t + ih - (v - lo) / (hi - lo) * ih;
  const sy = yScale(opts.yDomain), sy2 = opts.y2Domain ? yScale(opts.y2Domain) : null;
  const xf = opts.xFmt || (v => String(Math.round(v * 100) / 100)), yf = opts.yFmt || (v => String(Math.round(v * 100) / 100)), y2f = opts.y2Fmt || yf;

  const root = document.createElement('div');
  root.style.position = 'relative';
  const s = svg('svg', {viewBox: `0 0 ${W} ${H}`, width: '100%', role: 'img', 'aria-label': opts.label || 'Chart', style: 'display:block;touch-action:pan-y'});
  const text = (x, y, str, anchor = 'middle', extra = {}) => { const t = svg('text', {x, y, 'text-anchor': anchor, fill: '#cbd5e1', 'font-size': 10, ...extra}); t.textContent = str; return t; };
  for (const v of niceTicks(opts.yDomain[0], opts.yDomain[1], 4)) { const y = sy(v); s.append(svg('line', {x1: m.l, x2: W - m.r, y1: y, y2: y, stroke: '#334155', 'stroke-width': 1}), text(m.l - 5, y + 3, yf(v), 'end')); }
  if (sy2) for (const v of niceTicks(opts.y2Domain[0], opts.y2Domain[1], 4)) s.append(text(W - m.r + 5, sy2(v) + 3, y2f(v), 'start'));
  const xt = opts.xTicks || (opts.xLog ? [1, 2, 5, 10, 20, 50, 100, 200].filter(v => v >= x0 && v <= x1) : niceTicks(x0, x1, 6));
  for (const v of xt) { const x = sx(v); s.append(svg('line', {x1: x, x2: x, y1: m.t + ih, y2: m.t + ih + 4, stroke: '#64748b'}), text(x, H - 14, xf(v))); }
  if (opts.xTitle) s.append(text(m.l + iw / 2, H - 2, opts.xTitle, 'middle', {fill: '#94a3b8'}));
  if (opts.yTitle) s.append(text(12, m.t + ih / 2, opts.yTitle, 'middle', {fill: '#94a3b8', transform: `rotate(-90 12 ${m.t + ih / 2})`}));
  if (opts.y2Title) s.append(text(W - 10, m.t + ih / 2, opts.y2Title, 'middle', {fill: '#94a3b8', transform: `rotate(90 ${W - 10} ${m.t + ih / 2})`}));
  s.append(svg('line', {x1: m.l, x2: W - m.r, y1: m.t + ih, y2: m.t + ih, stroke: '#64748b'}));

  const clip = 'c' + Math.random().toString(36).slice(2, 8);
  const defs = svg('defs'), cp = svg('clipPath', {id: clip});
  cp.append(svg('rect', {x: m.l, y: m.t, width: iw, height: ih})); defs.append(cp); s.append(defs);
  const plot = svg('g', {'clip-path': `url(#${clip})`});
  s.append(plot);
  for (const ser of opts.series) {
    const f = ser.axis === 'y2' && sy2 ? sy2 : sy, base = f(Math.max(0, (ser.axis === 'y2' ? opts.y2Domain : opts.yDomain)[0])), pts = ser.data.filter(d => finite(d[0]) && finite(d[1]));
    if (ser.type === 'bar') {
      const bw = ser.barWidth ?? 1;
      for (const [x, y] of pts) { const px = sx(x), w = Math.max(1, Math.abs(sx(x + bw) - px) - 0.6), py = f(y); plot.append(svg('rect', {x: px, y: Math.min(py, base), width: w, height: Math.max(0.5, Math.abs(base - py)), fill: ser.color, opacity: ser.opacity ?? 0.9})); }
    } else if (ser.type === 'points') {
      for (const [x, y] of pts) plot.append(svg('circle', {cx: sx(x), cy: f(y), r: ser.r ?? 3, fill: ser.color, stroke: '#0f172a', 'stroke-width': 0.8}));
    } else {
      let d = '', pen = false, first = null, last = null;
      for (const [x, y] of ser.data) {
        if (!finite(x) || !finite(y)) { pen = false; continue; }
        const px = sx(x), py = f(y); d += (pen ? 'L' : 'M') + px.toFixed(1) + ' ' + py.toFixed(1); pen = true; first ??= px; last = px;
      }
      if (ser.type === 'area' && first !== null) plot.append(svg('path', {d: d + `L${last.toFixed(1)} ${base}L${first.toFixed(1)} ${base}Z`, fill: ser.color, opacity: ser.opacity ?? 0.35, stroke: 'none'}));
      if (d) plot.append(svg('path', {d, fill: 'none', stroke: ser.color, 'stroke-width': ser.width ?? 2, 'stroke-dasharray': ser.dash || '', 'stroke-linejoin': 'round'}));
    }
  }
  for (const v of opts.vlines || []) if (v.x >= x0 && v.x <= x1) { plot.append(svg('line', {x1: sx(v.x), x2: sx(v.x), y1: m.t, y2: m.t + ih, stroke: v.color || '#f8fafc', 'stroke-dasharray': '4 3', 'stroke-width': 1.2})); if (v.label) s.append(text(sx(v.x) + 3, m.t + 9, v.label, 'start', {fill: v.color || '#f8fafc'})); }

  const cross = svg('line', {y1: m.t, y2: m.t + ih, stroke: '#e2e8f0', 'stroke-width': 1, opacity: 0, 'pointer-events': 'none'}), dots = svg('g', {'pointer-events': 'none'});
  const tip = document.createElement('div');
  tip.setAttribute('role', 'status');
  tip.style.cssText = 'position:absolute;top:6px;pointer-events:none;display:none;z-index:5;background:#0f172a;border:1px solid #475569;border-radius:8px;padding:6px 8px;font-size:11px;line-height:1.5;color:#f1f5f9;max-width:220px;box-shadow:0 6px 18px #0008';
  const hit = svg('rect', {x: m.l, y: m.t, width: iw, height: ih, fill: 'transparent', style: 'cursor:crosshair'});
  s.append(cross, dots, hit);
  const toData = ev => { const r = s.getBoundingClientRect(); return {px: (ev.clientX - r.left) / r.width * W, scale: r.width / W}; };
  function nearest(px) {
    let best = null, bd = Infinity;
    for (const ser of opts.series) for (const d of ser.data) { if (!finite(d[0]) || !finite(d[1])) continue; const dd = Math.abs(sx(d[0]) - px); if (dd < bd) { bd = dd; best = d[0]; } }
    return best;
  }
  function show(ev) {
    const {px, scale} = toData(ev), x = nearest(px);
    if (x === null) return;
    cross.setAttribute('x1', sx(x)); cross.setAttribute('x2', sx(x)); cross.setAttribute('opacity', 0.8);
    dots.replaceChildren(); tip.replaceChildren();
    const head = document.createElement('strong'); head.textContent = (opts.hoverX || xf)(x); tip.append(head);
    for (const ser of opts.series) {
      if (ser.hover === false) continue;
      const d = ser.data.find(p => p[0] === x && finite(p[1]));
      if (!d) continue;
      const row = document.createElement('div'), sw = document.createElement('span');
      sw.style.cssText = `display:inline-block;width:8px;height:8px;border-radius:2px;margin-right:6px;background:${ser.color}`;
      row.append(sw, document.createTextNode(`${ser.name}: ${(ser.fmt || (ser.axis === 'y2' ? y2f : yf))(d[1])}`)); tip.append(row);
      dots.append(svg('circle', {cx: sx(x), cy: (ser.axis === 'y2' && sy2 ? sy2 : sy)(d[1]), r: 3.5, fill: ser.color, stroke: '#fff', 'stroke-width': 1}));
    }
    tip.style.display = 'block';
    const left = sx(x) * scale, w = tip.offsetWidth;
    tip.style.left = Math.max(0, Math.min(root.clientWidth - w, left + 12 > root.clientWidth - w ? left - w - 12 : left + 12)) + 'px';
  }
  hit.addEventListener('pointermove', show); hit.addEventListener('pointerdown', show);
  hit.addEventListener('pointerleave', () => { cross.setAttribute('opacity', 0); dots.replaceChildren(); tip.style.display = 'none'; });
  if (opts.onPick) hit.addEventListener('click', ev => { const x = nearest(toData(ev).px); if (x !== null) opts.onPick(x); });
  const legend = document.createElement('div');
  legend.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px 12px;margin-top:4px;font-size:11px;color:#cbd5e1';
  for (const ser of opts.series) { if (ser.legend === false) continue; const i = document.createElement('span'); i.innerHTML = '<span style="display:inline-block;width:10px;height:10px;border-radius:2px;margin-right:5px;vertical-align:-1px"></span>'; i.firstChild.style.background = ser.color; i.append(ser.name); legend.append(i); }
  root.append(s, tip, legend);
  return root;
}
