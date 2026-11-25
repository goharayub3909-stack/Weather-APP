// 3D terrain weather map of Pakistan: three.js terrain from AWS Terrain Tiles, animated wind trails, hourly rain and snow
// from the ECMWF IFS 9 km grid (scripts/sync-terrain-weather.mjs), a click-for-forecast panel. Pure logic is in core.js.
import * as THREE from 'three';
import {OrbitControls} from 'three/addons/OrbitControls.js';
import {renderForecast} from './forecast-ui.js';
import {cities} from '../cities.js';
import {GRID, GridSampler, validDataset, unpackDataset, mercX, mercY, lonOfX, latOfY, terrarium, WORLD_KM, rainColour, snowColour, windColour,
  elevationColour, splitPrecip, terrainWind, flowGrid, flowGridJob, summariseHours, encodeView, decodeView, PRESETS, SNOW_WATER_MM_PER_CM, temperatureColour, WIND_LEVELS, pointRows,
  maxTierFor, labelIndex, labelsNear, LOD_LEVELS, LOD_TILES, FADE_FRACTION, lodAlpha, blendHeight, lodWanted, lodHole, TEMPERATURE_TICKS,
  FLOW, WIND_SIM, simRowRange, spawnPlaneHeight, QUALITY_STEPS, newQuality, qualityStep, resetQuality, normalMapJob, windRampGlsl, RIBBON, STREAK, lengthControl, BOUNDARY, boundarySegments, WIDTH_CONTROL, clampWidthControl, zoomScale, lifespan, withMinimumSpeed, respawnBox, speedFromStep, slotInterval, trailLabel,
  validManifest, tileOf, tileSeries, phaseSeries, hasPhase, with1km, temperatureLut, rainLut, snowLut, LUT, parseLatLon, inForecastArea} from './core.js';
import {PIN_MODES, decodeTempPixel, modelTemperature, stepsNeeded, fmtBias, biasColour, obsPins} from './core.js';
import {fetchFeed} from '../observation-feed.js';
import {parseLabel} from '../realtime/core.js';
import {PRESSURE_LEVELS, levelAltitude, levelFile, levelReady, unpackLevelFile, mergeLevel, levelUnderground, UNDERGROUND_MARGIN_M, levelTemperatureColour, temperatureTicksFor, temperatureRange, forecastTable, WIND, WIND_RANGES, windRange, windMotion, wind1kmWeight, transitionAt, gridSpacings, gridOpacity, windTicks, surfaceRangeFrom, histogramPercentile, windSpeedFromCode, LEVEL_FADE_M} from './core.js';

const $ = id => document.getElementById(id);
const Z = 7, TILES = 2 ** Z, TILE_URL = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
const TX0 = Math.floor(mercX(GRID.west) * TILES), TX1 = Math.floor(mercX(GRID.east) * TILES);
const TY0 = Math.floor(mercY(GRID.north) * TILES), TY1 = Math.floor(mercY(GRID.south) * TILES);
const W = (TX1 - TX0 + 1) * 256, H = (TY1 - TY0 + 1) * 256;
const MX0 = TX0 / TILES, MX1 = (TX1 + 1) / TILES, MY0 = TY0 / TILES, MY1 = (TY1 + 1) / TILES;
const MXC = (MX0 + MX1) / 2, MYC = (MY0 + MY1) / 2, SCALE = WORLD_KM * Math.cos(30.5 * Math.PI / 180);   // km per Mercator unit at 30.5 N
const toScene = (lon, lat) => [(mercX(lon) - MXC) * SCALE, (mercY(lat) - MYC) * SCALE];                    // x east, z south
const toLonLat = (x, z) => [lonOfX(x / SCALE + MXC), latOfY(z / SCALE + MYC)];
const state = {hour: 0, playing: false, exag: 3, layers: new Set(['w', 'r', 's', 'c', 'k']), density: WIND_SIM.defaultCount, speed: 1, trailSegs: WIND_SIM.trailSegments.default, visible: true, detail: false, imagery: false, follow: true, border: true, obs: false, obsMode: 'bias', widthScale: WIDTH_CONTROL.default, level: 'sfc', sfcRange: WIND_RANGES.sfc};
let data = null, sampler = null, heights = null;
{ const q = +new URLSearchParams(location.search).get('density'); if (q >= 100) state.density = Math.min(q, WIND_SIM.maxParticles); }      // ?density=N: trails drawn (for testing)

// ---- renderer, camera, light ----
const canvas = $('scene'), renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: true});
// Pixel ratio: a 4K or Retina screen would run the terrain fragment shader on four times the pixels, and at a steep tilt the horizon makes that far worse.
// Capped at 1.5, and lowered further by the quality governor below while frames run slow.
const DPR_CAP = Math.min(devicePixelRatio || 1, 1.5);
renderer.setPixelRatio(DPR_CAP);
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(40, 1, 1, 30000);
const controls = new OrbitControls(camera, canvas);
// Map-style controls: drag to move, right-drag (or Ctrl-drag) to rotate and tilt, wheel zooms toward the cursor, two fingers pinch and twist.
Object.assign(controls, {enableDamping: true, dampingFactor: 0.09, minDistance: 3, maxDistance: 5000, maxPolarAngle: 1.38, screenSpacePanning: false, zoomToCursor: true, zoomSpeed: 1.1, rotateSpeed: 0.7, keyPanSpeed: 12});
controls.mouseButtons = {LEFT: THREE.MOUSE.PAN, MIDDLE: THREE.MOUSE.ROTATE, RIGHT: THREE.MOUSE.ROTATE};
controls.touches = {ONE: THREE.TOUCH.PAN, TWO: THREE.TOUCH.DOLLY_ROTATE};
controls.listenToKeyEvents(window);                                   // arrow keys move the map
const BOUNDS = {west: GRID.west - 1, east: GRID.east + 1, south: GRID.south - 1, north: GRID.north + 1};
const PLAIN_LIGHT = {sun: 7.0, hemi: 1.0};                               // elevation-colour terrain (no imagery): a strong sun and low ambient light, tuned for colour-managed (sRGB) rendering with Lambert shading to match the reference contrast
const hemi = new THREE.HemisphereLight(0xdfe8ee, 0x4a4030, PLAIN_LIGHT.hemi); scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff3df, PLAIN_LIGHT.sun); sun.position.set(-0.86, 1.0, -0.57); scene.add(sun);

function setView(v) {
  const [x, z] = toScene(v.lon, v.lat), t = v.tilt * Math.PI / 180, h = v.heading * Math.PI / 180;
  controls.target.set(x, 0, z);
  camera.position.set(x + v.dist * Math.sin(t) * Math.sin(h), v.dist * Math.cos(t), z + v.dist * Math.sin(t) * Math.cos(h));
  controls.update();
}
function readView() {
  const [lon, lat] = toLonLat(controls.target.x, controls.target.z), dist = camera.position.distanceTo(controls.target);
  return {lon, lat, dist, tilt: controls.getPolarAngle() * 180 / Math.PI, heading: controls.getAzimuthalAngle() * 180 / Math.PI};
}
let fly = null;
function flyTo(v) { fly = {from: readView(), to: v, t0: performance.now()}; }
function stepFly(now) {
  if (!fly) return;
  const k = Math.min(1, (now - fly.t0) / 1300), e = k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2, a = fly.from, b = fly.to, mix = (p, q) => p + (q - p) * e;
  let dh = b.heading - a.heading; dh = ((dh + 540) % 360) - 180;
  setView({lon: mix(a.lon, b.lon), lat: mix(a.lat, b.lat), dist: Math.exp(mix(Math.log(a.dist), Math.log(b.dist))), tilt: mix(a.tilt, b.tilt), heading: a.heading + dh * e});
  if (k >= 1) { fly = null; saveHash(); }
}

// Keep the view over Pakistan and the camera above the ground.
function keepInside() {
  const t = controls.target, [lon, lat] = toLonLat(t.x, t.z), cl = Math.min(Math.max(lon, BOUNDS.west), BOUNDS.east), ca = Math.min(Math.max(lat, BOUNDS.south), BOUNDS.north);
  if (cl !== lon || ca !== lat) { const [x, z] = toScene(cl, ca), dx = x - t.x, dz = z - t.z; t.x += dx; t.z += dz; camera.position.x += dx; camera.position.z += dz; }
  const floor = sceneHeightAt(camera.position.x, camera.position.z) + 1.5;
  if (camera.position.y < floor) camera.position.y = floor;
}
// ---- terrain ----
// Base: the whole country at tile zoom 7 (about 1.2 km per pixel). Detail: while the camera is close, nested 5 x 5 tile blocks around the view at
// zoom 9, 10 and 11 (about 250, 130 and 65 m per pixel) are drawn over it, each blending into the level below (see LOD_LEVELS in core.js).
// Satellite imagery (Esri World Imagery) is draped on all of them.
const IMG_URL = (z, x, y) => `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
const LOD_KEEP = 1.3;                                                  // a level is dropped once the camera is this much further than the distance that asked for it
const LOD_METRES = {9: '250 m', 10: '130 m', 11: '65 m'};
// Draws a block of tiles into one canvas. A tile that still fails after retries stays blank and is counted.
async function loadTiles(url, z, tx0, tx1, ty0, ty1, label) {
  const cw = (tx1 - tx0 + 1) * 256, ch = (ty1 - ty0 + 1) * 256, cv = document.createElement('canvas'); cv.width = cw; cv.height = ch;
  const ctx = cv.getContext('2d', {willReadFrequently: true}), jobs = [];
  let failed = 0, done = 0;
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) jobs.push([tx, ty]);
  const load = ([tx, ty]) => new Promise(resolve => {
    const tryLoad = attempt => { const img = new Image(); img.crossOrigin = 'anonymous';
      img.onload = () => { ctx.drawImage(img, (tx - tx0) * 256, (ty - ty0) * 256); done++; if (label) $('status').textContent = `Loading ${label}… ${done}/${jobs.length}`; resolve(); };
      img.onerror = () => attempt < 2 ? setTimeout(() => tryLoad(attempt + 1), 800 * (attempt + 1)) : (failed++, done++, resolve());
      img.src = url(z, tx, ty); };
    tryLoad(0);
  });
  for (let i = 0; i < jobs.length; i += 8) await Promise.all(jobs.slice(i, i + 8).map(load));
  return {canvas: cv, failed};
}
// Terrarium pixels to metres, and an elevation-colour canvas (the look used without imagery).
const ELEV_MIN = -4000, ELEV_LUT = (() => { const n = 13001, t = new Uint8Array(n * 3); for (let k = 0; k < n; k++) t.set(elevationColour(k + ELEV_MIN).slice(0, 3), k * 3); return t; })();   // metres to colour, one table
function* decodeDemJob(cv) {
  // Heights straight from the pixels, colours from the table: no allocation per pixel (this was 0.7 to 1.3 s of main-thread time per detail level).
  const w = cv.width, h = cv.height, ctx = cv.getContext('2d', {willReadFrequently: true}), px = ctx.getImageData(0, 0, w, h).data, hts = new Float32Array(w * h);
  const col = document.createElement('canvas'); col.width = w; col.height = h;
  const cctx = col.getContext('2d'), img = cctx.createImageData(w, h), out = img.data, top = ELEV_LUT.length / 3 - 1;
  yield;
  for (let y = 0; y < h; y++) {
    for (let i = y * w, j = i * 4, e = i + w; i < e; i++, j += 4) {
      const m = px[j + 3] === 0 ? 0 : px[j] * 256 + px[j + 1] + px[j + 2] / 256 - 32768;      // terrarium of core.js
      hts[i] = m;
      const k = (Math.min(top, Math.max(0, Math.round(m) - ELEV_MIN))) * 3;
      out[j] = ELEV_LUT[k]; out[j + 1] = ELEV_LUT[k + 1]; out[j + 2] = ELEV_LUT[k + 2]; out[j + 3] = 255;
    }
    if (y % 64 === 63) yield;
  }
  cctx.putImageData(img, 0, 0);
  return {hts, col};
}
function decodeDem(cv) { const it = decodeDemJob(cv); let r; while (!(r = it.next()).done); return r.value; }
const bilinear = (hts, w, fx, fy) => { const x = Math.floor(fx), y = Math.floor(fy), tx = fx - x, ty = fy - y, i = y * w + x; return (hts[i] * (1 - tx) + hts[i + 1] * tx) * (1 - ty) + (hts[i + w] * (1 - tx) + hts[i + w + 1] * tx) * ty; };
const lods = new Map();                                                // tile zoom (9, 10, 11) to its detail level
let baseFlow = null;
const heightAt = (lon, lat) => heightAtM(mercX(lon), mercY(lat));
// Metres at a Mercator position, from the finest detail level that covers it. `below` limits the search to levels under that zoom, which is how a
// new level reads the surface it has to blend into.
function heightAtM(mx, my, below = 99) {
  if (!heights) return 0;
  for (const z of [11, 10, 9]) {
    const L = lods.get(z);
    if (!L || z >= below) continue;
    const fx = (mx * L.n - L.tx0) * 256, fy = (my * L.n - L.ty0) * 256;
    if (fx >= 0 && fy >= 0 && fx < L.w - 1 && fy < L.h - 1) return Math.max(0, bilinear(L.heights, L.w, fx, fy));
  }
  const fx = (mx - MX0) / (MX1 - MX0) * (W - 1), fy = (my - MY0) / (MY1 - MY0) * (H - 1);
  if (!(fx >= 0 && fy >= 0 && fx < W - 1 && fy < H - 1)) return 0;
  return Math.max(0, bilinear(heights, W, fx, fy));
}
const sceneHeightAt = (x, z) => { const [lon, lat] = toLonLat(x, z); return heightAt(lon, lat) / 1000 * state.exag; };

let terrain = null, baseSat = null;
const display = document.createElement('canvas'); display.width = W; display.height = H;
const dctx = display.getContext('2d'), baseCanvas = document.createElement('canvas'); baseCanvas.width = W; baseCanvas.height = H;
const OW = 512, OH = Math.round(OW * H / W), overlay = document.createElement('canvas'); overlay.width = OW; overlay.height = OH;
const octx = overlay.getContext('2d'), oimg = octx.createImageData(OW, OH);
const tOverlay = document.createElement('canvas'); tOverlay.width = OW; tOverlay.height = OH;
const tctx = tOverlay.getContext('2d'), timg = tctx.createImageData(OW, OH);
const texture = new THREE.CanvasTexture(display); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;      // 8x anisotropic filtering keeps the terrain sharp at a grazing angle (it was 4x, which looked soft on tilted views)
// A level is cut away from every level below it, inside its own fade border, so the lower level never shows through (or pokes through) the detail.
const emptyHole = () => new THREE.Vector4(1, 1, -1, -1);
const holes = {base: {value: [emptyHole(), emptyHole(), emptyHole()]}, 9: {value: [emptyHole(), emptyHole(), emptyHole()]}, 10: {value: [emptyHole(), emptyHole(), emptyHole()]}, 11: {value: [emptyHole(), emptyHole(), emptyHole()]}};
function updateHoles() {
  const zs = [9, 10, 11].filter(z => lods.has(z));
  const inner = L => { const inset = lodHole * (L.x1 - L.x0); return new THREE.Vector4(L.x0 + inset, L.z0 + inset, L.x1 - inset, L.z1 - inset); };
  const fill = (target, above) => { target.value.forEach(v => v.set(1, 1, -1, -1)); above.slice(0, 3).forEach((z, i) => target.value[i].copy(inner(lods.get(z)))); };
  fill(holes.base, zs); for (const z of [9, 10, 11]) fill(holes[z], zs.filter(a => a > z));
  syncWindLevels();                                                    // the wind shaders read the same levels
}
// ---- 1 km downscaled forecast (public/terrain-data/grid-1km, written by downscaler/2_apply_1km_forecast.py) ----
// Temperature and rain are drawn by the terrain shader straight from the step PNGs (decoded on the GPU, blended between the two steps around the
// hour), so the CPU repaints nothing and only the steps in use are held. The same PNG pair gives the trails a mass-consistent 1 km 10 m wind.
const km1 = {m: null, tex: new Map(), loading: new Map(), ready: false, on: false, failed: 0, phase: false};      // ready: loaded at least once; on: drawn by the GPU at the hour now shown
const lutTexture = d => { const t = new THREE.DataTexture(d, 256, 1, THREE.RGBAFormat); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = t.minFilter = THREE.LinearFilter; t.needsUpdate = true; return t; };
const emptyRGB = new THREE.DataTexture(new Uint8Array(4), 1, 1); emptyRGB.needsUpdate = true;
const ku = {tTrA: {value: emptyRGB}, tTrB: {value: emptyRGB}, tPhA: {value: emptyRGB}, tPhB: {value: emptyRGB}, tW1A: {value: emptyRGB}, tW1B: {value: emptyRGB}, u1kMix: {value: 0}, u1kTemp: {value: 0},
  u1kRain: {value: 0}, u1kSnow: {value: 0}, u1kPhase: {value: 0}, u1kWind: {value: 0}, u1kBox: {value: new THREE.Vector4(GRID.west, GRID.north, 0.01, 0)}, u1kMap: {value: new THREE.Vector3(MXC, MYC, SCALE)},
  tTempLut: {value: lutTexture(temperatureLut())}, tRainLut: {value: lutTexture(rainLut())}, tSnowLut: {value: lutTexture(snowLut())}};
const DRAPE_HEAD = `
uniform sampler2D tTrA, tTrB, tPhA, tPhB, tTempLut, tRainLut, tSnowLut; uniform float u1kMix, u1kTemp, u1kRain, u1kSnow, u1kPhase; uniform vec4 u1kBox; uniform vec3 u1kMap;
// one 1 km cell: (degC, mm/h) from the packed RGB (temp code << 13 | rain code)
vec2 km1At(sampler2D t, ivec2 p) { vec3 c = floor(texelFetch(t, p, 0).rgb * 255. + .5); float v = c.r * 65536. + c.g * 256. + c.b, tc = floor(v / 8192.);
  return vec2(tc / 10. - 60., (v - tc * 8192.) / 10.); }
// snow share of one cell (red byte / 255), bilinear
float km1P(sampler2D t, ivec2 p) { return texelFetch(t, p, 0).r; }
float km1PBil(sampler2D t, vec2 f) {
  ivec2 sz = textureSize(t, 0); vec2 fl = floor(f), w = f - fl; ivec2 i0 = clamp(ivec2(fl), ivec2(0), sz - 1), i1 = clamp(ivec2(fl) + 1, ivec2(0), sz - 1);
  return mix(mix(km1P(t, i0), km1P(t, ivec2(i1.x, i0.y)), w.x), mix(km1P(t, ivec2(i0.x, i1.y)), km1P(t, i1), w.x), w.y);
}
vec2 km1Bil(sampler2D t, vec2 f) {
  ivec2 sz = textureSize(t, 0); vec2 fl = floor(f), w = f - fl; ivec2 i0 = clamp(ivec2(fl), ivec2(0), sz - 1), i1 = clamp(ivec2(fl) + 1, ivec2(0), sz - 1);
  return mix(mix(km1At(t, i0), km1At(t, ivec2(i1.x, i0.y)), w.x), mix(km1At(t, ivec2(i0.x, i1.y)), km1At(t, i1), w.x), w.y);
}`;
const DRAPE_CODE = `
 if (u1kTemp + u1kRain + u1kSnow > .5) {
  float mxw = vXZ.x / u1kMap.z + u1kMap.x, myw = vXZ.y / u1kMap.z + u1kMap.y;
  float lat1 = degrees(atan(sinh(3.14159265 - 6.28318531 * myw))), lon1 = (mxw - .5) * 360.;
  vec2 f1 = vec2((lon1 - u1kBox.x) / u1kBox.z - .5, (u1kBox.y - lat1) / u1kBox.z - .5); ivec2 sz1 = textureSize(tTrA, 0);
  if (f1.x > -.5 && f1.y > -.5 && f1.x < float(sz1.x) - .5 && f1.y < float(sz1.y) - .5) {
   vec2 v1 = mix(km1Bil(tTrA, f1), km1Bil(tTrB, f1), u1kMix);
   if (u1kTemp > .5) { vec4 c1 = texture(tTempLut, vec2(clamp((v1.x - (${LUT.tempMin}.)) / ${LUT.tempMax - LUT.tempMin}., 0., 1.) * (255. / 256.) + .5 / 256., .5)); diffuseColor.rgb = mix(diffuseColor.rgb, c1.rgb, c1.a); }
   // the 1 km water is split into rain and snow by the snow share (phase.py, Ding et al. 2014; sleet is half and half); without a phase set it is all rain (snow then stays on the 9 km overlay)
   float snowW = 0.; if (u1kPhase > .5) { float ps = mix(km1PBil(tPhA, f1), km1PBil(tPhB, f1), u1kMix); snowW = v1.y * ps; }
   float rainW = v1.y - snowW;
   if (u1kRain > .5 && rainW > 0.) { vec4 c1 = texture(tRainLut, vec2(clamp(log(1. + rainW) / log(${1 + LUT.rainMax}.), 0., 1.) * (255. / 256.) + .5 / 256., .5)); diffuseColor.rgb = mix(diffuseColor.rgb, c1.rgb, c1.a); }
   if (u1kSnow > .5 && snowW > 0.) { vec4 c1 = texture(tSnowLut, vec2(clamp(log(1. + snowW) / log(${1 + LUT.rainMax}.), 0., 1.) * (255. / 256.) + .5 / 256., .5)); diffuseColor.rgb = mix(diffuseColor.rgb, c1.rgb, c1.a); }
  }
 }`;
// Shader changes shared by the base and the detail levels: discard fragments inside the holes, and (detail only) fade the colour in from the edge.
function lodShader(sh, holeUniform, withFade) {
  sh.uniforms.uHoles = holeUniform; Object.assign(sh.uniforms, ku);
  sh.vertexShader = (withFade ? 'attribute float fade; varying float vFade;\n' : '') + 'varying vec2 vXZ;\n' + sh.vertexShader.replace('#include <begin_vertex>', '#include <begin_vertex>\n vXZ = position.xz;' + (withFade ? '\n vFade = fade;' : ''));
  sh.fragmentShader = (withFade ? 'varying float vFade;\n' : '') + 'varying vec2 vXZ; uniform vec4 uHoles[3];\n' + DRAPE_HEAD + '\n' + sh.fragmentShader
    .replace('void main() {', 'void main() {\n for (int i = 0; i < 3; i++) { if (vXZ.x > uHoles[i].x && vXZ.y > uHoles[i].y && vXZ.x < uHoles[i].z && vXZ.y < uHoles[i].w) discard; }')
    .replace('#include <color_fragment>', '#include <color_fragment>' + DRAPE_CODE + (withFade ? '\n diffuseColor.a *= vFade;' : ''));
}

// Tile-aligned height grid to a mesh. (otx, oty) is the tile coordinate of pixel (0,0) at zoom z. With blend, the border follows the level below:
// outer border = its heights exactly, next border = a smooth change to this level's own heights; `fade` is the colour alpha for the shader.
function* gridGeometryJob(hts, w, h, otx, oty, z, step, blend = false) {
  const n = 2 ** z, cols = Math.floor((w - 1) / step) + 1, rows = Math.floor((h - 1) / step) + 1;
  const pos = new Float32Array(cols * rows * 3), uv = new Float32Array(cols * rows * 2), fade = blend ? new Float32Array(cols * rows) : null, nrm = new Float32Array(cols * rows * 3);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const px = Math.min(i * step, w - 1), py = Math.min(j * step, h - 1), k = j * cols + i, mx = (otx + px / 256) / n, my = (oty + py / 256) / n;
      let height = Math.max(0, hts[py * w + px]);
      if (blend) {
        const edge = Math.min(px, py, w - 1 - px, h - 1 - py) / (w - 1);
        if (edge < 2 * FADE_FRACTION) height = blendHeight(heightAtM(mx, my, z), height, edge);
        fade[k] = lodAlpha(edge);
      }
      pos[k * 3] = (mx - MXC) * SCALE; pos[k * 3 + 1] = height / 1000; pos[k * 3 + 2] = (my - MYC) * SCALE;
      uv[k * 2] = px / (w - 1); uv[k * 2 + 1] = 1 - py / (h - 1);
    }
    if (j % 16 === 15) yield;
  }
  const idx = new Uint32Array((cols - 1) * (rows - 1) * 6);
  let q = 0;
  for (let j = 0; j < rows - 1; j++) {
    for (let i = 0; i < cols - 1; i++) { const a = j * cols + i, b = a + 1, c = a + cols, d = c + 1; idx[q++] = a; idx[q++] = c; idx[q++] = b; idx[q++] = b; idx[q++] = c; idx[q++] = d; }
    if (j % 32 === 31) yield;
  }
  // Normals from the height grid (central differences on the final positions, one-sided at the edges): the same surface as computeVertexNormals gave, but it
  // can be done a few rows at a time, which computeVertexNormals (one call over every triangle) cannot.
  for (let j = 0; j < rows; j++) {
    const jn = Math.max(j - 1, 0) * cols, js = Math.min(j + 1, rows - 1) * cols;
    for (let i = 0; i < cols; i++) {
      const k = j * cols + i, kw = j * cols + Math.max(i - 1, 0), ke = j * cols + Math.min(i + 1, cols - 1), kn = jn + i, ks = js + i;
      const dx = pos[ke * 3] - pos[kw * 3], dz = pos[ks * 3 + 2] - pos[kn * 3 + 2];
      const nx = dx > 0 ? -(pos[ke * 3 + 1] - pos[kw * 3 + 1]) / dx : 0, nz = dz > 0 ? -(pos[ks * 3 + 1] - pos[kn * 3 + 1]) / dz : 0, inv = 1 / Math.sqrt(nx * nx + 1 + nz * nz);
      nrm[k * 3] = nx * inv; nrm[k * 3 + 1] = inv; nrm[k * 3 + 2] = nz * inv;
    }
    if (j % 32 === 31) yield;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.BufferAttribute(nrm, 3)); g.setAttribute('uv', new THREE.BufferAttribute(uv, 2)); g.setIndex(new THREE.BufferAttribute(idx, 1));
  if (fade) g.setAttribute('fade', new THREE.BufferAttribute(fade, 1));
  return g;
}
// All at once (the base terrain at start-up) ...
function gridGeometry(hts, w, h, otx, oty, z, step, blend = false) { const it = gridGeometryJob(hts, w, h, otx, oty, z, step, blend); let r; while (!(r = it.next()).done); return r.value; }
// ... or in slices of about SLICE_MS, handing the thread back to the browser between them so camera, wind and input never wait for a detail level (it used to be
// one block of 150 to 200 ms). Returns the geometry and the milliseconds of work it took.
const SLICE_MS = 5;
// ---- quality governor ---- (the rule is qualityStep in core.js)
const quality = newQuality();
function adaptQuality(now, frameMs) { if (qualityStep(quality, now, frameMs)) renderer.setPixelRatio(DPR_CAP * QUALITY_STEPS[quality.level].dpr); }
const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
const yieldToMain = () => new Promise(resolve => { const ch = new MessageChannel(); ch.port1.onmessage = () => resolve(); ch.port2.postMessage(0); });
async function runSliced(it) {
  let work = 0, t0 = performance.now(), r;
  while (!(r = it.next()).done) { if (performance.now() - t0 >= SLICE_MS) { work += performance.now() - t0; await yieldToMain(); t0 = performance.now(); } }
  work += performance.now() - t0;
  return {value: r.value, work};
}
// ---- normal maps from the full-resolution heights (normalMapJob in core.js explains the maths) ----
// The mesh has a vertex every 4th (base) or 2nd (detail) height pixel, so its vertex normals light the relief at that resolution only; this gives the light every pixel's slope.
// Tangent space, so no tangents are needed; the vertex normals themselves are untouched. A map depends on the exaggeration, so it is rebuilt (sliced, after a short pause) when that changes.
function normalTexture(data, w, h) {
  const t = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  t.colorSpace = THREE.NoColorSpace; t.flipY = false; t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter; t.anisotropy = 8; t.needsUpdate = true;
  return t;
}
const baseNormals = {hts: null, w: W, h: H, z: Z, step: 4, mat: null, tex: null, gen: 0};           // one record per level: heights, size, mesh step, material, texture, run counter
async function genNormals(t) {
  const token = ++t.gen, exag = state.exag, out = t.tex ? t.tex.image.data : new Uint8Array(t.w * t.h * 4);
  const job = normalMapJob(t.hts, t.w, t.h, SCALE / (2 ** t.z * 256), t.step, exag, out);
  const guarded = (function* () { while (t.gen === token) { if (job.next().done) return true; yield; } return false; })();      // a newer run (or a dropped level) stops this one
  if (!(await runSliced(guarded)).value) return false;
  if (!t.tex) { t.tex = normalTexture(out, t.w, t.h); t.mat.normalMap = t.tex; t.mat.needsUpdate = true; } else t.tex.needsUpdate = true;
  if (exag !== state.exag) scheduleNormals();                                                       // the slider moved while this was being built
  return true;
}
let normalTimer = 0;
function scheduleNormals(delay = 300) {
  clearTimeout(normalTimer);
  normalTimer = setTimeout(async () => {
    if (baseNormals.mat) { baseNormals.step = state.detail ? 2 : 4; await genNormals(baseNormals); }
    for (const L of [...lods.values()]) if (L.nrm) await genNormals(L.nrm);
  }, delay);
}
function buildTerrain() {
  const step = state.detail ? 2 : 4, g = gridGeometry(heights, W, H, TX0, TY0, Z, step);
  setDrawHeights(0, g, Math.floor((W - 1) / step) + 1, Math.floor((H - 1) / step) + 1, MX0, MY0, 256 * TILES / step, 256 * TILES / step);      // the trails follow THIS mesh
  if (terrain) { terrain.geometry.dispose(); terrain.geometry = g; scheduleNormals(0); return; }     // another vertex spacing: the base map is rebuilt for it
  const mat = new THREE.MeshLambertMaterial({map: texture});
  mat.customProgramCacheKey = () => 'lod-base'; mat.onBeforeCompile = sh => lodShader(sh, holes.base, false);
  terrain = new THREE.Mesh(g, mat);
  terrain.scale.y = state.exag; scene.add(terrain);
  Object.assign(baseNormals, {hts: heights, mat, step: state.detail ? 2 : 4}); genNormals(baseNormals);
}

// ---- detail levels ----
let patchBusy = false, moveStamp = 0;
function disposeLevel(L) { scene.remove(L.mesh); L.mesh.geometry.dispose(); L.mesh.material.dispose(); L.texture.dispose(); L.hTex?.dispose(); L.fTex?.dispose(); if (L.nrm) { L.nrm.gen++; L.nrm.tex?.dispose(); } if (lods.get(L.z) === L) dropDrawHeights(L.z); }
function removeLevel(z) { const L = lods.get(z); if (!L) return; disposeLevel(L); lods.delete(z); updateHoles(); setDetailNote(); }
const lodTimes = window.__lodTimes = [];                                // main-thread milliseconds of each detail level's synchronous stages (read by ?fps and by profiling)
function tick(lap, name, fn) { const t0 = performance.now(), r = fn(); lap[name] = +(performance.now() - t0).toFixed(1); return r; }
async function startLevel(z, tx0, ty0) {
  patchBusy = true; setDetailNote('Loading detail…');
  const T = LOD_TILES, n = 2 ** z, lap = {z};
  try {
    // imagery tiles only while imagery is on (they were fetched for nothing otherwise); switching it on later fetches them for the levels that exist (ensureLevelImagery)
    const [dem, img] = await Promise.all([loadTiles(TILE_URL, z, tx0, tx0 + T - 1, ty0, ty0 + T - 1), state.imagery ? loadTiles(IMG_URL, z, tx0, tx0 + T - 1, ty0, ty0 + T - 1) : null]);
    if (dem.failed > T * T / 2) throw Error('terrain tiles unavailable');
    const dec = await runSliced(decodeDemJob(dem.canvas)); lap.decode = +dec.work.toFixed(1);
    const {hts, col} = dec.value, w = T * 256, h = T * 256;
    const pdisplay = document.createElement('canvas'); pdisplay.width = w; pdisplay.height = h;
    const tex = new THREE.CanvasTexture(pdisplay); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
    const mat = new THREE.MeshLambertMaterial({map: tex, transparent: true, polygonOffset: true, polygonOffsetFactor: 0, polygonOffsetUnits: -(z - 8)});     // a few depth units only: a slope-dependent offset (factor) pulls grazing terrain over the trails
    mat.customProgramCacheKey = () => 'lod-detail'; mat.onBeforeCompile = sh => lodShader(sh, holes[z], true);
    const built = await runSliced(gridGeometryJob(hts, w, h, tx0, ty0, z, 2, true)); lap.mesh = +built.work.toFixed(1);
    setDrawHeights(z, built.value, Math.floor((w - 1) / 2) + 1, Math.floor((h - 1) / 2) + 1, tx0 / n, ty0 / n, 256 * n / 2, 256 * n / 2);     // sliced: the longest single block is about SLICE_MS
    const mesh = new THREE.Mesh(built.value, mat);
    mesh.scale.y = state.exag; mesh.renderOrder = z - 8;                     // detail after the opaque base, finer after coarser
    const mx0 = tx0 / n, mx1 = (tx0 + T) / n, my0 = ty0 / n, my1 = (ty0 + T) / n;
    const L = {z, n, tx0, ty0, w, h, heights: hts, elev: col, sat: !img || img.failed > T * T / 2 ? null : img.canvas, display: pdisplay, texture: tex, mesh, mx0, mx1, my0, my1,
      x0: (mx0 - MXC) * SCALE, x1: (mx1 - MXC) * SCALE, z0: (my0 - MYC) * SCALE, z1: (my1 - MYC) * SCALE};
    const cellM = 1 / n / 256 * 4 * SCALE * 1000;                            // metres per flow cell (4 pixels)
    const fl = await runSliced(flowGridJob(hts, w, h, 4, z === 11 ? 3 : z === 10 ? 2 : 1, z === 11 ? 16 : z === 10 ? 10 : 6, cellM)); lap.flow = +fl.work.toFixed(1);
    L.flow = {...fl.value, mx0, mx1, my0, my1};
    L.nrm = {hts, w, h, z, step: 2, mat, tex: null, gen: 0};
    await genNormals(L.nrm);
    tick(lap, 'textures', () => makeLevelTextures(L));
    // Reaching the GPU is the last big cost: ~25 MB of mesh and several 1280 x 1280 textures. Draw the content first (so the one upload carries it), then send
    // the textures and the mesh to the GPU in separate frames, so no single frame has to take all of it (one frame used to take everything).
    tick(lap, 'paint', () => paintPatch(L));
    await nextFrame(); renderer.initTexture(L.texture);
    if (L.hTex || L.fTex) { await nextFrame(); if (L.hTex) renderer.initTexture(L.hTex); if (L.fTex) renderer.initTexture(L.fTex); }
    if (L.nrm.tex) { await nextFrame(); renderer.initTexture(L.nrm.tex); }
    await nextFrame();
    const old = lods.get(z); lods.set(z, L); scene.add(mesh); if (old) disposeLevel(old);
    tick(lap, 'holes', updateHoles); setDetailNote();
    if (resetQuality(quality, performance.now())) renderer.setPixelRatio(DPR_CAP * QUALITY_STEPS[0].dpr);      // the frames of this load must not cost quality afterwards
    if (state.imagery && !L.sat) ensureLevelImagery(L);
    lap.total = +['decode', 'mesh', 'flow', 'textures', 'holes', 'paint'].reduce((a, k) => a + (lap[k] || 0), 0).toFixed(1); lodTimes.push(lap);
  } catch (e) { setDetailNote('Detail unavailable: ' + e.message); }
  finally { patchBusy = false; }
}
function paintPatch(L) {
  const ctx = L.display.getContext('2d');
  ctx.drawImage(state.imagery && L.sat ? L.sat : L.elev, 0, 0);
  const sx = (L.mx0 - MX0) / (MX1 - MX0) * OW, sw = (L.mx1 - L.mx0) / (MX1 - MX0) * OW, sy = (L.my0 - MY0) / (MY1 - MY0) * OH, sh = (L.my1 - L.my0) / (MY1 - MY0) * OH;
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  if (tempDrawn) ctx.drawImage(tOverlay, sx, sy, sw, sh, 0, 0, L.w, L.h);
  if (overlayDrawn) ctx.drawImage(overlay, sx, sy, sw, sh, 0, 0, L.w, L.h);
  L.texture.needsUpdate = true;
}
// Imagery for a level that was built without it (imagery was off) or whose imagery failed: fetched when imagery is switched on.
async function ensureLevelImagery(L) {
  if (L.sat || L.satBusy) return;
  L.satBusy = true;
  try {
    const T = LOD_TILES, img = await loadTiles(IMG_URL, L.z, L.tx0, L.tx0 + T - 1, L.ty0, L.ty0 + T - 1);
    if (img.failed <= T * T / 2 && lods.get(L.z) === L) { L.sat = img.canvas; if (state.imagery) paintPatch(L); }
  } catch { /* the elevation colours stay */ } finally { L.satBusy = false; }
}
function setDetailNote(msg) {
  const el = $('detail-state'); if (!el) return;
  const have = [9, 10, 11].filter(z => lods.has(z)).map(z => LOD_METRES[z]);
  el.textContent = msg || (have.length ? `Detail on: ${have.join(' + ')} terrain and imagery around the view` : 'Zoom in for 250 m, 130 m and 65 m detail');
}
// One level is loaded at a time, coarsest first, when the camera has stopped. A level is reloaded when the view leaves its middle 3 x 3 tiles.
function checkPatch(now) {
  if (patchBusy || !heights || fly || now - moveStamp < 500) return;
  const dist = camera.position.distanceTo(controls.target), wanted = lodWanted(dist);
  for (const l of LOD_LEVELS) if (lods.has(l.z) && dist > l.maxDist * LOD_KEEP) { removeLevel(l.z); return; }
  const [lon, lat] = toLonLat(controls.target.x, controls.target.z);
  for (const z of wanted) {
    const n = 2 ** z, tx = Math.floor(mercX(lon) * n), ty = Math.floor(mercY(lat) * n), L = lods.get(z);
    if (!L || tx < L.tx0 + 1 || tx > L.tx0 + LOD_TILES - 2 || ty < L.ty0 + 1 || ty > L.ty0 + LOD_TILES - 2) { startLevel(z, tx - 2, ty - 2); return; }
  }
}
// The height gradients for the wind adjustment: from the finest level that covers the point.
function pickFlow(mx, my) {
  for (const z of [11, 10, 9]) { const L = lods.get(z); if (L?.flow && mx >= L.mx0 && mx < L.mx1 && my >= L.my0 && my < L.my1) return L.flow; }
  return baseFlow;
}

// ---- temperature, rain and snow drapes ----
let overlayHour = -99, overlayDrawn = false, tempDrawn = false;
function paintOverlay(force = false) {
  if (!force && Math.abs(overlayHour - state.hour) < 0.1) return;
  overlayHour = state.hour;
  dctx.drawImage(state.imagery && baseSat ? baseSat : baseCanvas, 0, 0);
  dctx.imageSmoothingEnabled = true; dctx.imageSmoothingQuality = 'high';
  // with the 1 km set loaded, temperature, rain and (when the set has the phase split) snow are drawn by the terrain shader (DRAPE_CODE); otherwise snow stays here
  const lvl = state.level, tField = lvl === 'sfc' ? 't2m' : 't' + lvl, gField = 'gh' + lvl;
  const wantRain = state.layers.has('r') && !km1.on, wantSnow = state.layers.has('s') && !(km1.on && km1.phase), wantTemp = state.layers.has('t') && !!sampler?.has(tField) && !(km1.on && state.level === 'sfc');
  tempDrawn = false; overlayDrawn = false;
  if (sampler && (wantRain || wantSnow || wantTemp)) {
    const lons = new Float32Array(OW), mxs = new Float32Array(OW); for (let i = 0; i < OW; i++) { lons[i] = lonOfX(MX0 + (i + 0.5) / OW * (MX1 - MX0)); mxs[i] = mercX(lons[i]); }
    const td = timg.data, d = oimg.data;
    for (let j = 0; j < OH; j++) {
      const lat = latOfY(MY0 + (j + 0.5) / OH * (MY1 - MY0)), my = mercY(lat);
      for (let i = 0; i < OW; i++) {
        const o = (j * OW + i) * 4;
        if (wantTemp) {
          let t = sampler.sample(tField, state.hour, lons[i], lat);
          if (t !== null && lvl !== 'sfc') { const gh = sampler.sample(gField, state.hour, lons[i], lat); if (gh === null || levelUnderground(heightAtM(mxs[i], my), gh)) t = null; }    // underground at this level: no colour
          const c = t === null ? null : lvl === 'sfc' ? temperatureColour(t) : levelTemperatureColour(t, lvl);
          if (c) { td[o] = c[0]; td[o + 1] = c[1]; td[o + 2] = c[2]; td[o + 3] = c[3]; } else td[o + 3] = 0; }
        if (wantRain || wantSnow) {
          const p = sampler.precip(state.hour, lons[i], lat);
          let c = null;
          if (p) { const r = wantRain ? p.rain : 0, s = wantSnow ? p.snowWater : 0; c = s >= r ? snowColour(s) : rainColour(r); }
          if (c) { d[o] = c[0]; d[o + 1] = c[1]; d[o + 2] = c[2]; d[o + 3] = c[3]; } else d[o + 3] = 0;
        }
      }
    }
    if (wantTemp) { tctx.putImageData(timg, 0, 0); dctx.drawImage(tOverlay, 0, 0, W, H); tempDrawn = true; }
    if (wantRain || wantSnow) { octx.putImageData(oimg, 0, 0); dctx.drawImage(overlay, 0, 0, W, H); overlayDrawn = true; }
  }
  texture.needsUpdate = true;
  for (const L of lods.values()) paintPatch(L);
}

// ---- clouds ----
// ECMWF total cloud cover (per cent, hourly) sets how much of the sky is covered; animated noise sets the shapes, so the clouds
// drift with the wind and slowly change. The noise is decoration: the coverage per area and hour is the forecast.
const CW = 256, CH = Math.round(256 * H / W), cloudTextures = new Map();
function cloudTexture(hourIdx) {
  if (cloudTextures.has(hourIdx)) return cloudTextures.get(hourIdx);
  const px = new Uint8Array(CW * CH * 4);
  for (let j = 0; j < CH; j++) {
    const lat = latOfY(MY1 - (j + 0.5) / CH * (MY1 - MY0));
    for (let i = 0; i < CW; i++) {
      const c = sampler ? sampler.cell('cloud', hourIdx, lonOfX(MX0 + (i + 0.5) / CW * (MX1 - MX0)), lat) : null, o = (j * CW + i) * 4;
      if (c === null) { px[o + 3] = 0; continue; }                                                // missing stays missing: no cloud drawn
      px[o] = Math.round(Math.min(100, Math.max(0, c)) * 2.55); px[o + 3] = 255;
    }
  }
  const t = new THREE.DataTexture(px, CW, CH, THREE.RGBAFormat); t.minFilter = t.magFilter = THREE.LinearFilter; t.needsUpdate = true;
  if (cloudTextures.size > 80) { const k = cloudTextures.keys().next().value; cloudTextures.get(k).dispose(); cloudTextures.delete(k); }
  cloudTextures.set(hourIdx, t); return t;
}
const EXTENT_X = (MX1 - MX0) * SCALE, EXTENT_Z = (MY1 - MY0) * SCALE;
const cloudMaterial = new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
  uniforms: {uA: {value: null}, uB: {value: null}, uMix: {value: 0}, uTime: {value: 0}, uDrift: {value: new THREE.Vector2()}, uAspect: {value: EXTENT_Z / EXTENT_X}},
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: [
    'precision highp float; varying vec2 vUv; uniform sampler2D uA, uB; uniform float uMix, uTime, uAspect; uniform vec2 uDrift;',
    'float hash(vec3 p){ p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }',
    'float noise(vec3 x){ vec3 i = floor(x), f = fract(x); f = f * f * (3.0 - 2.0 * f);',
    '  return mix(mix(mix(hash(i), hash(i + vec3(1,0,0)), f.x), mix(hash(i + vec3(0,1,0)), hash(i + vec3(1,1,0)), f.x), f.y),',
    '             mix(mix(hash(i + vec3(0,0,1)), hash(i + vec3(1,0,1)), f.x), mix(hash(i + vec3(0,1,1)), hash(i + vec3(1,1,1)), f.x), f.y), f.z); }',
    'float fbm(vec3 p){ float a = 0.5, s = 0.0; for (int k = 0; k < 5; k++) { s += a * noise(p); p = p * 2.03 + vec3(7.1, 3.7, 1.3); a *= 0.5; } return s; }',
    'void main(){',
    '  vec4 a = texture2D(uA, vUv), b = texture2D(uB, vUv);',
    '  float valid = min(a.a, b.a); float cover = mix(a.r, b.r, uMix);',
    '  vec2 p = (vUv * vec2(1.0, uAspect)) * 18.0 - uDrift;',
    '  float n = fbm(vec3(p, uTime * 0.035)) * 0.75 + fbm(vec3(p * 2.7 + 4.0, uTime * 0.07)) * 0.25;',
    '  float edge = 1.0 - cover * 1.08;',
    '  float d = smoothstep(edge, edge + 0.22, n) * smoothstep(0.03, 0.14, cover) * valid;',
    '  vec3 col = mix(vec3(0.58, 0.64, 0.75), vec3(1.0), smoothstep(0.30, 0.72, n));',
    '  gl_FragColor = vec4(col, d * mix(0.45, 0.78, cover));',
    '}',
  ].join('\n'),
});
const cloudMesh = new THREE.Mesh(new THREE.PlaneGeometry(EXTENT_X, EXTENT_Z).rotateX(-Math.PI / 2), cloudMaterial);
cloudMesh.renderOrder = 30; cloudMesh.frustumCulled = false; scene.add(cloudMesh);
const CLOUD_SIM_SECONDS = 2400;                                      // the clouds' own time scale: seconds of wind per real second at the reference distance
const cloudHeight = () => 3 + 2.4 * state.exag;                         // km in the scene: above most terrain, moves with the exaggeration
let driftU = 0, driftV = 0, cloudTime = 0;
function updateClouds(dt) {
  if (!sampler) { cloudMesh.visible = false; return; }
  cloudMesh.visible = state.layers.has('k'); if (!cloudMesh.visible) return;
  cloudMesh.position.y = cloudHeight();
  const seg = sampler.segment(state.hour);
  cloudMaterial.uniforms.uA.value = cloudTexture(seg.i0); cloudMaterial.uniforms.uB.value = cloudTexture(seg.i1); cloudMaterial.uniforms.uMix.value = seg.w;
  const [lon, lat] = toLonLat(controls.target.x, controls.target.z), w = sampler.wind(state.hour, Math.min(Math.max(lon, GRID.west), GRID.east), Math.min(Math.max(lat, GRID.south), GRID.north)) || {u: 0, v: 0};
  const km = dt * CLOUD_SIM_SECONDS * state.speed * zoomScale(camera.position.distanceTo(controls.target)) / 1000;      // clouds drift with the wind, slower than the trails, and at the same screen speed at every zoom                      // same time scale as the wind trails
  driftU += w.u * km / EXTENT_X * 18; driftV += -w.v * km / EXTENT_X * 18; cloudTime += dt * state.speed;   // v is north, the texture's second axis points north too
  cloudMaterial.uniforms.uDrift.value.set(driftU, -driftV); cloudMaterial.uniforms.uTime.value = cloudTime;
}
// ---- wind trails ----
const TRAIL = 8, MAXP = 32000, SIM_SECONDS = WIND_SIM.simSeconds, TRAIL_EVERY = 5;      // one real second shows 2,400 s of wind; a trail point is kept every 6th frame so trails are long enough to see
let frameNo = 0;
const plon = new Float32Array(MAXP), plat = new Float32Array(MAXP), page = new Float32Array(MAXP), plife = new Float32Array(MAXP);
const pmx = new Float32Array(MAXP), pmy = new Float32Array(MAXP);                 // Mercator position of each particle
const hist = new Float32Array(MAXP * TRAIL * 3), speedNow = new Float32Array(MAXP);
const segPos = new Float32Array(MAXP * (TRAIL - 1) * 6), segCol = new Float32Array(MAXP * (TRAIL - 1) * 8);
const windGeo = new THREE.BufferGeometry();
windGeo.setAttribute('position', new THREE.BufferAttribute(segPos, 3).setUsage(THREE.DynamicDrawUsage));
windGeo.setAttribute('color', new THREE.BufferAttribute(segCol, 4).setUsage(THREE.DynamicDrawUsage));
const windLines = new THREE.LineSegments(windGeo, new THREE.LineBasicMaterial({vertexColors: true, transparent: true, depthWrite: false}));
windLines.frustumCulled = false; windLines.renderOrder = 20; scene.add(windLines);
// Trails are drawn just above the ground (a ground-level wind). The lift grows with the view distance only enough to stay clear of the surface.
let LIFT = 0.1;
// Particles are born around what is on screen, so a zoomed-in view is as dense as the whole-country view.
let viewR = 2500;
const inGrid = (lon, lat) => lon >= GRID.west && lon <= GRID.east && lat >= GRID.south && lat <= GRID.north;
const place = i => {                                                          // writes the Mercator and scene position of particle i; returns its trail height
  const mx = plon[i] / 360 + 0.5, my = mercY(plat[i]), x = (mx - MXC) * SCALE, z = (my - MYC) * SCALE;
  pmx[i] = mx; pmy[i] = my;
  const ground = heightAtM(mx, my) / 1000 * state.exag + LIFT;
  return [x, state.level === 'sfc' ? ground : Math.max(ground, WIND_LEVELS[state.level].heightKm * state.exag + LIFT), z];   // pressure levels are drawn at about their height
};
const respawn = i => {
  let lon = 0, lat = 0, ok = false;
  for (let tries = 0; tries < 4 && !ok; tries++) {
    const ang = Math.random() * 2 * Math.PI, r = viewR * Math.sqrt(Math.random());
    [lon, lat] = toLonLat(controls.target.x + r * Math.cos(ang), controls.target.z + r * Math.sin(ang)); ok = inGrid(lon, lat);
  }
  if (!ok) { lon = GRID.west + Math.random() * (GRID.east - GRID.west); lat = GRID.south + Math.random() * (GRID.north - GRID.south); }
  plon[i] = lon; plat[i] = lat; page[i] = 0; plife[i] = lifespan(Math.random()); speedNow[i] = 0;
  const p = place(i); for (let k = 0; k < TRAIL; k++) hist.set(p, (i * TRAIL + k) * 3); };
for (let i = 0; i < MAXP; i++) respawn(i);
// Height gradient and relief at a Mercator position, from the detail patch where it covers the point and from the base otherwise.
let fGx = 0, fGn = 0, fTpi = 0;
function sampleFlow(mx, my) {
  const F = pickFlow(mx, my);
  if (!F) { fGx = fGn = fTpi = 0; return; }
  const fx = (mx - F.mx0) / (F.mx1 - F.mx0) * (F.cw - 1), fy = (my - F.my0) / (F.my1 - F.my0) * (F.ch - 1);
  if (!(fx >= 0 && fy >= 0 && fx < F.cw - 1 && fy < F.ch - 1)) { fGx = fGn = fTpi = 0; return; }
  const x = Math.floor(fx), y = Math.floor(fy), tx = fx - x, ty = fy - y, i = y * F.cw + x, w = F.cw;
  const lerp = arr => (arr[i] * (1 - tx) + arr[i + 1] * tx) * (1 - ty) + (arr[i + w] * (1 - tx) + arr[i + w + 1] * tx) * ty;
  fGx = lerp(F.gx); fGn = lerp(F.gn); fTpi = lerp(F.tpi);
}
const flowOut = [0, 0], minOut = [0, 0], linearCol = new THREE.Color();
function stepWind(dt) {
  if (!sampler) return;
  const dist = camera.position.distanceTo(controls.target);
  viewR = Math.min(2500, Math.max(25, dist * 1.15));
  LIFT = Math.min(2.5, Math.max(0.05, dist * 0.0012));
  frameNo++;
  const n = Math.min(state.density, 6000), sim = dt * SIM_SECONDS * state.speed * zoomScale(dist);      // the CPU path is the fallback: fewer particles
  for (let i = 0; i < n; i++) {
    const w = sampler.wind(state.hour, plon[i], plat[i], state.level);
    if (!w || ++page[i] > plife[i] || Math.hypot(hist[i * TRAIL * 3] - controls.target.x, hist[i * TRAIL * 3 + 2] - controls.target.z) > viewR * 1.6) { respawn(i); continue; }
    let u = w.u, v = w.v;
    if (state.follow && state.level === 'sfc') { sampleFlow(pmx[i], pmy[i]); terrainWind(u, v, fGx, fGn, fTpi, flowOut); u = flowOut[0]; v = flowOut[1]; }
    const mv = withMinimumSpeed(u, v, Math.random() * 6.2831853, WIND_SIM.minSpeed, minOut); u = mv[0]; v = mv[1];
    plon[i] += u * sim / (111320 * Math.cos(plat[i] * Math.PI / 180)); plat[i] += v * sim / 111320; speedNow[i] = Math.hypot(u, v);
    if (plon[i] < GRID.west || plon[i] > GRID.east || plat[i] < GRID.south || plat[i] > GRID.north) { respawn(i); continue; }
    const base = i * TRAIL * 3;
    if (frameNo % TRAIL_EVERY === 0) hist.copyWithin(base + 3, base, base + (TRAIL - 1) * 3);
    const p = place(i); hist[base] = p[0]; hist[base + 1] = p[1]; hist[base + 2] = p[2];
  }
  let s = 0, c = 0;
  for (let i = 0; i < n; i++) {
    const col = windColour(speedNow[i] / windRange(state.level, state.sfcRange)); linearCol.setRGB(col[0] / 255, col[1] / 255, col[2] / 255, THREE.SRGBColorSpace);          // the line material wants linear vertex colours
    const life = Math.min(1, page[i] / 12, (plife[i] - page[i]) / 20), base = i * TRAIL * 3, calm = 0.4 + 0.6 * Math.min(1, speedNow[i] / 3);
    for (let k = 0; k < TRAIL - 1; k++) {
      const a = (1 - k / (TRAIL - 1)) ** 1.6 * life * calm * 0.95;
      segPos.set(hist.subarray(base + k * 3, base + k * 3 + 6), s); s += 6;
      segCol.set([linearCol.r, linearCol.g, linearCol.b, a, linearCol.r, linearCol.g, linearCol.b, a * 0.8], c); c += 8;
    }
  }
  windGeo.setDrawRange(0, n * (TRAIL - 1) * 2);
  windGeo.attributes.position.needsUpdate = true; windGeo.attributes.color.needsUpdate = true;
}

// ---- wind trails on the GPU ----
// Everything per particle stays on the GPU; the CPU only sets a few numbers per frame (no per-particle loop, no per-frame uploads).
// - State: x and y in km from a local origin near the view, age, lifespan, for up to 8,192 particles in two float textures swapped every frame
//   (ping-pong). Local kilometres, not longitude and latitude: a float32 longitude near 73 E has a step of about 0.7 m, so at close zoom a calm-air
//   particle's step (0.2 to 0.8 m a frame) would round away; near the origin the step is millimetres. A fragment shader moves, ages and recycles them.
// - Trail history: a ring buffer of 13 recorded positions per particle (lon, lat, age when recorded, lifespan as a tag of the life it belongs to) in a
//   second pair of float textures; every WIND_SIM.slotSeconds a pass copies the current positions into the next slot.
// - Drawing: each trail is a ribbon through 14 points (the live head and the 13 recorded positions, newest first), and the vertex shader reads the
//   terrain height at every one of them, so the ribbon follows the ground over ridges instead of cutting straight through them or hanging in the air.
//   Recorded positions from the particle's previous life are not used, so a respawned particle grows a new trail instead of drawing a line across the map.
// Rules (lifespan, recycling, minimum speed, zoom scaling, trail fade): WIND_SIM and the trail functions in core.js, mirrored by the GLSL below.
// If the GPU cannot render to float textures the CPU simulation above is used instead.
const GPU_W = 256, GPU_H = 96, GPU_N = GPU_W * GPU_H;
const STREAK_KEEP = 0.85;                                                // share of the chosen density the quality governor may take away: streaks are cheap, the terrain is what is slow
// ?cpuwind in the address forces the CPU simulation (for testing the fallback).
const gpuWind = renderer.capabilities.isWebGL2 && renderer.extensions.has('EXT_color_buffer_float') && renderer.capabilities.maxVertexTextures >= 15 && renderer.capabilities.maxTextureSize >= GPU_W && !new URLSearchParams(location.search).has('cpuwind');
let gpuReady = false, gpuLines = null, activeRows = 0, resetNext = true, windKey = '', baseHTex = null, baseFTex = null, simCur = 0, simFrame = 0;
function floatTexture(data, w, h, format = THREE.RGBAFormat) { const t = new THREE.DataTexture(data, w, h, format, THREE.FloatType); t.needsUpdate = true; return t; }
const emptyF = floatTexture(new Float32Array(4), 1, 1), emptyR = floatTexture(new Float32Array(1), 1, 1, THREE.RedFormat);
function flowTexture(F) {
  const n = F.cw * F.ch, d = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) { d[4 * i] = F.gx[i]; d[4 * i + 1] = F.gn[i]; d[4 * i + 2] = F.tpi[i]; d[4 * i + 3] = 1; }
  return floatTexture(d, F.cw, F.ch);
}
// Uniforms shared by the simulation and the drawing shaders (the same objects, so one update reaches both).
const v4 = () => new THREE.Vector4(), v2 = () => new THREE.Vector2();
const wu = {
  u1kBlend: {value: 1},                                                  // weight of the 1 km wind over the last hour of the 1 km set (wind1kmWeight of core.js)
  uLevelKm: {value: 0},                                                  // standard height in km of the wind level shown (0 = the surface): shared by the simulation and the drawing
  tWindA: {value: emptyF}, tWindB: {value: emptyF}, uMix: {value: 0}, uGrid: {value: new THREE.Vector4(GRID.west, GRID.south, 1, 1)}, uSpacing: {value: 0.1},
  uSurface: {value: 1}, uFollow: {value: 1}, uOn: {value: new THREE.Vector3()}, uO: {value: new THREE.Vector4(GRID.west, GRID.south, 100, 111.19)},
  tFlow0: {value: emptyF}, tFlow9: {value: emptyF}, tFlow10: {value: emptyF}, tFlow11: {value: emptyF},
  uFB0: {value: v4()}, uFB9: {value: v4()}, uFB10: {value: v4()}, uFB11: {value: v4()}, uFS0: {value: v2()}, uFS9: {value: v2()}, uFS10: {value: v2()}, uFS11: {value: v2()},
  tH0: {value: emptyR}, tH9: {value: emptyR}, tH10: {value: emptyR}, tH11: {value: emptyR},
  uHB0: {value: v4()}, uHB9: {value: v4()}, uHB10: {value: v4()}, uHB11: {value: v4()}, uHS0: {value: v2()}, uHS9: {value: v2()}, uHS10: {value: v2()}, uHS11: {value: v2()},
  tD: {value: emptyR}, uDB0: {value: v4()}, uDB9: {value: v4()}, uDB10: {value: v4()}, uDB11: {value: v4()}, uDO0: {value: v4()}, uDO9: {value: v4()}, uDO10: {value: v4()}, uDO11: {value: v4()}, uDOn: {value: v4()},
};
function makeBaseTextures() {
  if (!gpuWind) return;
  baseHTex = floatTexture(heights, W, H, THREE.RedFormat); baseFTex = flowTexture(baseFlow); syncWindLevels();
}
function makeLevelTextures(L) {
  if (!gpuWind) return;
  L.hTex = floatTexture(L.heights, L.w, L.h, THREE.RedFormat); L.fTex = flowTexture(L.flow);
}
// Draw-height atlas: the y of every vertex of each mesh (the base: every 4th DEM pixel, 2nd with Detail on; a detail level: every 2nd, border blended), in metres, so the trails
// are placed on the surface that is drawn. Slots are stacked: base, zoom 9, 10, 11. Rebuilt when the mesh changes (Detail toggled, a level loaded or dropped).
const DRAW_W = 1024, DRAW_SLOT = {0: [0, 1024], 9: [1024, 640], 10: [1664, 640], 11: [2304, 640]}, DRAW_H = 2944;
let drawAtlas = null;
function setDrawHeights(slot, geometry, cols, rows, mx0, my0, cellsPerMercatorX, cellsPerMercatorY) {
  if (!gpuWind || renderer.capabilities.maxTextureSize < DRAW_H) return;
  const [y0, maxRows] = DRAW_SLOT[slot];
  if (cols > DRAW_W || rows > maxRows) { wu.uDOn.value.setComponent(slot === 0 ? 0 : slot - 8, 0); return; }              // does not fit: the full-resolution heights are used
  if (!drawAtlas) { const data = new Float32Array(DRAW_W * DRAW_H); drawAtlas = {data, tex: floatTexture(data, DRAW_W, DRAW_H, THREE.RedFormat)}; wu.tD.value = drawAtlas.tex; }
  const pos = geometry.attributes.position.array, d = drawAtlas.data;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) d[(y0 + j) * DRAW_W + i] = pos[(j * cols + i) * 3 + 1] * 1000;
  drawAtlas.tex.needsUpdate = true;
  wu['uDB' + slot].value.set(mx0, my0, cellsPerMercatorX, cellsPerMercatorY); wu['uDO' + slot].value.set(0, y0, cols, rows);
  wu.uDOn.value.setComponent(slot === 0 ? 0 : slot - 8, 1);
}
const dropDrawHeights = slot => wu.uDOn.value.setComponent(slot === 0 ? 0 : slot - 8, 0);
// Points the shaders at the base and at whichever detail levels exist.
function syncWindLevels() {
  if (!gpuWind) return;
  wu.tFlow0.value = baseFTex || emptyF; wu.tH0.value = baseHTex || emptyR;
  wu.uFB0.value.set(MX0, MX1, MY0, MY1); wu.uFS0.value.set(baseFlow?.cw ?? 1, baseFlow?.ch ?? 1);
  wu.uHB0.value.set(MX0, MY0, (W - 1) / (MX1 - MX0), (H - 1) / (MY1 - MY0)); wu.uHS0.value.set(W, H);
  for (const z of [9, 10, 11]) {
    const L = lods.get(z), ok = !!L?.hTex;
    wu['tH' + z].value = ok ? L.hTex : emptyR; wu['tFlow' + z].value = ok ? L.fTex : emptyF;
    if (ok) { wu['uHB' + z].value.set(L.mx0, L.my0, 256 * L.n, 256 * L.n); wu['uHS' + z].value.set(L.w, L.h); wu['uFB' + z].value.set(L.mx0, L.mx1, L.my0, L.my1); wu['uFS' + z].value.set(L.flow.cw, L.flow.ch); }
    wu.uOn.value.setComponent(z - 9, ok ? 1 : 0);
  }
}
// One RGBA float texture per forecast step and wind level: (u, v, valid, 1). A missing cell has valid 0, so a missing corner makes the wind missing
// (as in the CPU sampler) instead of being read as calm. Textures are recycled, so changing step allocates nothing after the first few.
const windTex = new Map();
function windStepTexture(level, i) {
  const k = level + ':' + i, hit = windTex.get(k);
  if (hit) { windTex.delete(k); windTex.set(k, hit); return hit; }
  const ku = level === 'sfc' ? 'u' : 'u' + level, kv = level === 'sfc' ? 'v' : 'v' + level, U = sampler.d[ku]?.[i], V = sampler.d[kv]?.[i];
  const GH = level === 'sfc' ? null : sampler.d['gh' + level]?.[i];                 // geometric height of the level in m (a level file has it)
  if (!U || !V) return null;
  let t = null;
  if (windTex.size >= 10) { const oldest = windTex.keys().next().value; t = windTex.get(oldest); windTex.delete(oldest); }
  const g = sampler.d.grid, data = t ? t.image.data : new Float32Array(g.columns * g.rows * 4);
  for (let n = 0, m = g.columns * g.rows; n < m; n++) {
    const ok = Number.isFinite(U[n]) && Number.isFinite(V[n]) && (!GH || Number.isFinite(GH[n]));
    data[4 * n] = ok ? U[n] : 0; data[4 * n + 1] = ok ? V[n] : 0; data[4 * n + 2] = ok ? 1 : 0; data[4 * n + 3] = GH && ok ? GH[n] / 1000 : 0;       // alpha: the level height in km, 0 when unknown
  }
  if (t) t.needsUpdate = true; else t = floatTexture(data, g.columns, g.rows);
  windTex.set(k, t); return t;
}
function updateWindTextures() {
  const seg = sampler.segment(state.hour), key = state.level + ':' + seg.i0 + ':' + seg.i1;
  wu.uMix.value = seg.w;
  if (key === windKey) return;
  windKey = key;
  wu.tWindA.value = windStepTexture(state.level, seg.i0) || emptyF; wu.tWindB.value = windStepTexture(state.level, seg.i1) || emptyF;
}

Object.assign(wu, {tW1A: ku.tW1A, tW1B: ku.tW1B, u1kWind: ku.u1kWind, u1kMix: ku.u1kMix, u1kBox: ku.u1kBox});
const GLSL_COMMON = `
uniform sampler2D tW1A, tW1B; uniform float u1kWind, u1kMix, u1kBlend; uniform vec4 u1kBox;
uniform sampler2D tWindA, tWindB; uniform float uMix, uSpacing, uSurface, uFollow; uniform vec4 uGrid, uO; uniform vec3 uOn;   // uO: origin lon, lat, km per degree of longitude and of latitude there
uniform sampler2D tFlow0, tFlow9, tFlow10, tFlow11; uniform vec4 uFB0, uFB9, uFB10, uFB11; uniform vec2 uFS0, uFS9, uFS10, uFS11;
const float PI = 3.14159265;
float mercX(float lon) { return lon / 360. + .5; }
float mercY(float lat) { float s = sin(radians(clamp(lat, -85.05, 85.05))); return .5 - log((1. + s) / (1. - s)) / (4. * PI); }
vec4 bil4(sampler2D t, vec2 f, vec2 sz) {
  vec2 fl = floor(f), w = f - fl; ivec2 i0 = ivec2(fl), i1 = min(i0 + 1, ivec2(sz) - 1);
  vec4 a = texelFetch(t, i0, 0), b = texelFetch(t, ivec2(i1.x, i0.y), 0), c = texelFetch(t, ivec2(i0.x, i1.y), 0), d = texelFetch(t, i1, 0);
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}
// Terrain height (m) of the finest level that covers a Mercator point: the 1 km-class DEM (250 m at the coarsest detail level, 65 m at the finest).
uniform float uLevelKm; uniform sampler2D tH0, tH9, tH10, tH11; uniform vec4 uHB0, uHB9, uHB10, uHB11; uniform vec2 uHS0, uHS9, uHS10, uHS11;
uniform sampler2D tD; uniform vec4 uDB0, uDB9, uDB10, uDB11, uDO0, uDO9, uDO10, uDO11, uDOn;
float bilR(sampler2D t, vec2 f, vec2 sz) {
  vec2 fl = floor(f), w = f - fl; ivec2 i0 = ivec2(fl), i1 = min(i0 + 1, ivec2(sz) - 1);
  float a = texelFetch(t, i0, 0).r, b = texelFetch(t, ivec2(i1.x, i0.y), 0).r, c = texelFetch(t, ivec2(i0.x, i1.y), 0).r, d = texelFetch(t, i1, 0).r;
  return mix(mix(a, b, w.x), mix(c, d, w.x), w.y);
}
bool hIn(sampler2D t, vec4 b, vec2 sz, float mx, float my, out float h) {
  vec2 f = vec2((mx - b.x) * b.z, (my - b.y) * b.w);
  if (f.x < 0. || f.y < 0. || f.x >= sz.x - 1. || f.y >= sz.y - 1.) return false;
  h = max(0., bilR(t, f, sz)); return true;
}
// Draw heights: the heights of the MESH (every 4th DEM pixel on the base, every 2nd on a detail level, the blended border heights included), in one atlas texture tD
// (a slot per level: uDO = x offset, y offset, columns, rows; uDB = Mercator origin and lattice cells per Mercator unit; uDOn says which slots hold a mesh). Inside a cell the
// height is the one of the triangle the mesh draws there (the cell's diagonal runs from its east-top to its west-bottom corner), so a trail lies ON the surface that is seen.
bool drawIn(vec4 b, vec4 o, float mx, float my, out float h) {
  vec2 f = vec2((mx - b.x) * b.z, (my - b.y) * b.w);
  if (f.x < 0. || f.y < 0. || f.x > o.z - 1. || f.y > o.w - 1.) return false;
  vec2 fl = min(floor(f), o.zw - 2.), t = f - fl; ivec2 p = ivec2(o.xy) + ivec2(fl);
  float ha = texelFetch(tD, p, 0).r, hb = texelFetch(tD, p + ivec2(1, 0), 0).r, hc = texelFetch(tD, p + ivec2(0, 1), 0).r, hd = texelFetch(tD, p + ivec2(1, 1), 0).r;
  h = t.x + t.y <= 1. ? ha + t.x * (hb - ha) + t.y * (hc - ha) : hd + (1. - t.x) * (hc - hd) + (1. - t.y) * (hb - hd);
  return true;
}
float groundM(float mx, float my);
float groundDrawM(float mx, float my) {
  float h;
  if (uDOn.w > .5 && drawIn(uDB11, uDO11, mx, my, h)) return max(h, 0.);
  if (uDOn.z > .5 && drawIn(uDB10, uDO10, mx, my, h)) return max(h, 0.);
  if (uDOn.y > .5 && drawIn(uDB9, uDO9, mx, my, h)) return max(h, 0.);
  if (uDOn.x > .5 && drawIn(uDB0, uDO0, mx, my, h)) return max(h, 0.);
  return groundM(mx, my);                                              // no mesh heights yet: the full-resolution ones
}
float groundM(float mx, float my) {
  float h;
  if (uOn.z > .5 && hIn(tH11, uHB11, uHS11, mx, my, h)) return h;
  if (uOn.y > .5 && hIn(tH10, uHB10, uHS10, mx, my, h)) return h;
  if (uOn.x > .5 && hIn(tH9, uHB9, uHS9, mx, my, h)) return h;
  if (hIn(tH0, uHB0, uHS0, mx, my, h)) return h;
  return 0.;
}
// (u, v, valid, level height in km) from the grid, linear between the two forecast steps; any missing corner of the four around the point makes it missing. The height (w) is bilinear.
// windGridH is that, bilinear in space too (used where only the level height or validity is wanted). windGrid takes u and v from a Catmull-Rom surface over the 4 x 4 cells around the
// point (indices clamped at the edge) wherever all 16 are valid (windFromBlock of core.js), the bilinear value elsewhere.
vec4 windGridH(vec2 ll) {
  vec2 sz = uGrid.zw, f = (ll - uGrid.xy) / uSpacing;
  if (f.x < 0. || f.y < 0. || f.x > sz.x - 1. || f.y > sz.y - 1.) return vec4(0.);
  vec4 a = bil4(tWindA, f, sz), b = bil4(tWindB, f, sz);
  bool ok = uMix <= 0. ? a.z > .999 : (a.z > .999 && b.z > .999);
  return vec4(mix(a.xy, b.xy, uMix), ok ? 1. : 0., mix(a.w, b.w, uMix));
}
vec4 crSpline4(vec4 p0, vec4 p1, vec4 p2, vec4 p3, float t) {
  float t2 = t * t, t3 = t2 * t;
  return .5 * (2. * p1 + (p2 - p0) * t + (2. * p0 - 5. * p1 + 4. * p2 - p3) * t2 + (3. * p1 - p0 - 3. * p2 + p3) * t3);
}
vec4 bicubic4(sampler2D t, vec2 f, vec2 sz, out bool ok) {
  ivec2 szi = ivec2(sz), i1 = ivec2(floor(f)); vec2 w = f - floor(f);
  int x0 = clamp(i1.x - 1, 0, szi.x - 1), x1 = clamp(i1.x, 0, szi.x - 1), x2 = clamp(i1.x + 1, 0, szi.x - 1), x3 = clamp(i1.x + 2, 0, szi.x - 1);
  vec4 col[4]; ok = true;
  for (int j = 0; j < 4; j++) {
    int y = clamp(i1.y - 1 + j, 0, szi.y - 1);
    vec4 p0 = texelFetch(t, ivec2(x0, y), 0), p1 = texelFetch(t, ivec2(x1, y), 0), p2 = texelFetch(t, ivec2(x2, y), 0), p3 = texelFetch(t, ivec2(x3, y), 0);
    ok = ok && p0.z > .999 && p1.z > .999 && p2.z > .999 && p3.z > .999;
    col[j] = crSpline4(p0, p1, p2, p3, w.x);
  }
  return crSpline4(col[0], col[1], col[2], col[3], w.y);
}
vec4 windGrid(vec2 ll) {
  vec4 g = windGridH(ll);
  if (g.z < .5) return g;
  vec2 sz = uGrid.zw, f = (ll - uGrid.xy) / uSpacing; bool okA, okB = false;
  vec4 ca = bicubic4(tWindA, f, sz, okA);
  vec2 a = okA ? ca.xy : bil4(tWindA, f, sz).xy, b = a;
  if (uMix > 0.) { vec4 cb = bicubic4(tWindB, f, sz, okB); b = okB ? cb.xy : bil4(tWindB, f, sz).xy; }
  return vec4(mix(a, b, uMix), g.zw);
}
bool inB(vec4 b, float mx, float my) { return mx >= b.x && mx < b.y && my >= b.z && my < b.w; }
// Slope and relief, smoothed: a 5-tap filter (centre weighted twice, plus 1.5 cells either way along both axes) on top of the bilinear lookup,
// so the deflection field has no sharp creases that particles could collect along.
vec3 flowIn(sampler2D t, vec4 b, vec2 sz, float mx, float my) {
  vec2 f = vec2((mx - b.x) / (b.y - b.x), (my - b.z) / (b.w - b.z)) * (sz - 1.);
  if (f.x < 0. || f.y < 0. || f.x >= sz.x - 1. || f.y >= sz.y - 1.) return vec3(0.);
  vec2 hi = sz - 1.001;
  vec3 c = bil4(t, f, sz).xyz * 2.;
  c += bil4(t, clamp(f + vec2(1.5, 0.), vec2(0.), hi), sz).xyz + bil4(t, clamp(f - vec2(1.5, 0.), vec2(0.), hi), sz).xyz;
  c += bil4(t, clamp(f + vec2(0., 1.5), vec2(0.), hi), sz).xyz + bil4(t, clamp(f - vec2(0., 1.5), vec2(0.), hi), sz).xyz;
  return c / 6.;
}
// (height gradient east, north, relief) from the finest level that covers the point, as pickFlow in app.js
vec3 flowAt(float mx, float my) {
  if (uOn.z > .5 && inB(uFB11, mx, my)) return flowIn(tFlow11, uFB11, uFS11, mx, my);
  if (uOn.y > .5 && inB(uFB10, mx, my)) return flowIn(tFlow10, uFB10, uFS10, mx, my);
  if (uOn.x > .5 && inB(uFB9, mx, my)) return flowIn(tFlow9, uFB9, uFS9, mx, my);
  return flowIn(tFlow0, uFB0, uFS0, mx, my);
}
// terrainWind of core.js: flow running uphill into a steep slope loses its uphill part and keeps the part along the contour, v - (v . n) n, so it
// slides along the slope instead of being driven into the crest; crests are faster and valleys slower
vec2 terrainWindGL(vec2 w, vec3 f) {
  float s = length(f.xy); vec2 o = w;
  if (s > 1e-4) { vec2 n = f.xy / s; float up = dot(w, n); if (up > 0.) o -= min(1., s / ${FLOW.slopeFull.toFixed(4)}) * ${FLOW.deflect.toFixed(4)} * up * n; }
  return o * (1. + ${FLOW.speedGain.toFixed(4)} * clamp(f.z / ${FLOW.tpiScaleM.toFixed(1)}, -1., 1.));
}
// 1 km mass-consistent 10 m wind (u code << 12 | v code): bilinear in space, between the two steps in time; missing anywhere -> not used
vec3 w1At(sampler2D t, ivec2 p) { vec3 c = floor(texelFetch(t, p, 0).rgb * 255. + .5); float v = c.r * 65536. + c.g * 256. + c.b, uc = floor(v / 4096.), vc = v - uc * 4096.;
  return uc > 4094.5 || vc > 4094.5 ? vec3(0.) : vec3((uc - 2048.) / 50., (vc - 2048.) / 50., 1.); }
vec3 w1Bil(sampler2D t, vec2 f) {
  ivec2 sz = textureSize(t, 0); vec2 fl = floor(f), w = f - fl; ivec2 i0 = clamp(ivec2(fl), ivec2(0), sz - 1), i1 = clamp(ivec2(fl) + 1, ivec2(0), sz - 1);
  vec3 a = w1At(t, i0), b = w1At(t, ivec2(i1.x, i0.y)), c = w1At(t, ivec2(i0.x, i1.y)), d = w1At(t, i1);
  return a.z * b.z * c.z * d.z > .5 ? vec3(mix(mix(a.xy, b.xy, w.x), mix(c.xy, d.xy, w.x), w.y), 1.) : vec3(0.);
}
// Catmull-Rom over the 4 x 4 cells of the 1 km wind around the point: the same surface as windGrid's, for the packed (u, v) codes; missing (z = 0) if any of the 16 is missing
vec2 crSpline2(vec2 p0, vec2 p1, vec2 p2, vec2 p3, float t) {
  float t2 = t * t, t3 = t2 * t;
  return .5 * (2. * p1 + (p2 - p0) * t + (2. * p0 - 5. * p1 + 4. * p2 - p3) * t2 + (3. * p1 - p0 - 3. * p2 + p3) * t3);
}
vec3 w1Cubic(sampler2D t, vec2 f) {
  ivec2 sz = textureSize(t, 0), i1 = ivec2(floor(f)); vec2 w = f - floor(f);
  int x0 = clamp(i1.x - 1, 0, sz.x - 1), x1 = clamp(i1.x, 0, sz.x - 1), x2 = clamp(i1.x + 1, 0, sz.x - 1), x3 = clamp(i1.x + 2, 0, sz.x - 1);
  vec2 col[4]; bool ok = true;
  for (int j = 0; j < 4; j++) {
    int y = clamp(i1.y - 1 + j, 0, sz.y - 1);
    vec3 p0 = w1At(t, ivec2(x0, y)), p1 = w1At(t, ivec2(x1, y)), p2 = w1At(t, ivec2(x2, y)), p3 = w1At(t, ivec2(x3, y));
    ok = ok && p0.z * p1.z * p2.z * p3.z > .5;
    col[j] = crSpline2(p0.xy, p1.xy, p2.xy, p3.xy, w.x);
  }
  return ok ? vec3(crSpline2(col[0], col[1], col[2], col[3], w.y), 1.) : vec3(0.);
}
vec3 wind1km(vec2 ll) {
  vec2 f = vec2((ll.x - u1kBox.x) / u1kBox.z - .5, (u1kBox.y - ll.y) / u1kBox.z - .5); ivec2 sz = textureSize(tW1A, 0);
  if (f.x < 0. || f.y < 0. || f.x > float(sz.x - 1) || f.y > float(sz.y - 1)) return vec3(0.);
  vec3 a = w1Bil(tW1A, f), b = w1Bil(tW1B, f);
  if (a.z * b.z < .5) return vec3(0.);
  vec3 ca = w1Cubic(tW1A, f), cb = w1Cubic(tW1B, f);                   // bicubic where all 16 cells are there, else the bilinear value
  if (ca.z > .5) a = ca;
  if (cb.z > .5) b = cb;
  return vec3(mix(a.xy, b.xy, u1kMix), 1.);
}
vec3 windEcmwf(vec2 ll) {                                              // the ECMWF wind with the terrain rules (the surface wind outside or without the 1 km layer)
  vec4 g = windGrid(ll); vec3 w = g.xyz;
  if (w.z < .5) return w;
  // a pressure level is underground where the 1 km terrain is higher than the level's own height (levelUnderground of core.js): no wind there, the particle is
  // recycled, so nothing runs through the mountains. g.w is 0 when the height is not known (an old grid without level files): the model's own mask stays.
  if (uLevelKm > 0. && g.w > 0. && groundM(mercX(ll.x), mercY(ll.y)) + ${UNDERGROUND_MARGIN_M.toFixed(1)} > g.w * 1000.) return vec3(0.);
  if (uSurface > .5 && uFollow > .5) w.xy = terrainWindGL(w.xy, flowAt(mercX(ll.x), mercY(ll.y)));
  return w;
}
vec3 velocityAt(vec2 ll) {
  // surface trails with "Follow the terrain": the 1 km mass-consistent wind where it is loaded, else ECMWF with the slope rule. Over the last hour of the 1 km set the two are blended
  // (u1kBlend 1 -> 0, so there is no jump where the 1 km wind ends).
  if (uSurface > .5 && uFollow > .5 && u1kWind > .5) {
    vec3 k = wind1km(ll);
    if (k.z > .5) {
      if (u1kBlend > .999) return k;
      vec3 e = windEcmwf(ll);
      return e.z > .5 ? vec3(mix(e.xy, k.xy, u1kBlend), 1.) : k;
    }
  }
  return windEcmwf(ll);
}`;
const SIM_VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }';
const SIM_FS = GLSL_COMMON + `
uniform sampler2D tState; uniform float uSim, uAge, uSeed, uReset, uMinSpeed, uRebase, uScreenShare, uScale; uniform vec4 uSpawn, uBox, uOold, uSpawnPlane; uniform vec3 uView, uCamPos; uniform vec2 uLife, uMC;   // uView: view centre in local km, radius km
uniform mat4 uInvProj, uCamWorld;
varying vec2 vUv;
// Where a new particle is born. Most are placed evenly over the SCREEN: a random screen point is turned into a ray and the particle goes where the ray meets
// the ground. Evenly over the ground would crowd the far part of a tilted view and leave the foreground, which fills most of the screen, nearly empty.
// The rest (and any ray that misses the ground or the data area) are placed evenly over the part of the data area that is in view.
vec2 spawnLonLat(vec2 r1, vec2 r2) {
  vec2 box = vec2(mix(uSpawn.x, uSpawn.y, r1.x), mix(uSpawn.z, uSpawn.w, r1.y));
  if (r2.y > uScreenShare) return box;
  vec4 v = uInvProj * vec4(r1 * 2. - 1., 1., 1.); v /= v.w;
  vec3 dir = normalize((uCamWorld * vec4(v.xyz, 1.)).xyz - uCamPos);
  if (dir.y > -1e-3) return box;
  vec3 hit = uCamPos + dir * ((uSpawnPlane.x - uCamPos.y) / dir.y);
  if (length(hit.xz - uSpawnPlane.yz) > uSpawnPlane.w) return box;
  float mx = hit.x / uScale + uMC.x, my = hit.z / uScale + uMC.y;
  vec2 ll = vec2((mx - .5) * 360., degrees(atan(sinh(PI - 2. * PI * my))));
  if (ll.x < uBox.x || ll.x > uBox.y || ll.y < uBox.z || ll.y > uBox.w) return box;
  return ll;
}
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
void main() {
  vec4 s = texture2D(tState, vUv);                                    // x, y (km from the origin), age, lifespan
  if (uRebase > .5) {                                                  // the origin moved: express x, y from the new one
    vec2 was = vec2(uOold.x + s.x / uOold.z, uOold.y + s.y / uOold.w);
    s.xy = vec2((was.x - uO.x) * uO.z, (was.y - uO.y) * uO.w);
  }
  vec2 r1 = hash22(vUv * 713.31 + uSeed), r2 = hash22(vUv * 197.77 - uSeed * 1.37);
  vec2 ll = vec2(uO.x + s.x / uO.z, uO.y + s.y / uO.w);                // lon, lat
  vec3 vel = velocityAt(ll);
  // midpoint (RK2) step: half a step along the wind here, the wind found there carries the whole step. Where that wind is missing the particle is recycled, as for a missing wind here.
  vec3 vel2 = vec3(0.);
  if (vel.z > .5) vel2 = velocityAt(ll + vec2(vel.x * uSim * .5 / (111320. * cos(radians(ll.y))), vel.y * uSim * .5 / 111320.));
  bool outBox = ll.x < uBox.x || ll.x > uBox.y || ll.y < uBox.z || ll.y > uBox.w;
  bool far = length(s.xy - uView.xy) > uView.z * ${WIND_SIM.outsideFactor.toFixed(2)};
  bool dead = s.z >= s.w || s.w <= 0.;
  if (uReset > .5 || dead || outBox || far || vel.z < .5 || vel2.z < .5) {   // recycle at once: a random place in the area on screen, a new random lifespan
    float life = uLife.x + r2.x * (uLife.y - uLife.x);
    vec2 p = spawnLonLat(r1, r2);
    if (uLevelKm > 0.) {                                               // at a pressure level a spot where the level is underground is no place to start: try other places
      for (int k = 1; k < 4; k++) {
        if (velocityAt(p).z > .5) break;
        p = spawnLonLat(hash22(vUv * 91.3 + uSeed * 1.7 + float(k) * 17.1), hash22(vUv * 53.9 - uSeed * 2.3 + float(k) * 7.7));
      }
    }
    gl_FragColor = vec4((p.x - uO.x) * uO.z, (p.y - uO.y) * uO.w, uReset > .5 ? r2.y * life : 0., life);
    return;
  }
  vec2 w = vel2.xy; float sp0 = length(w);                             // the minimum-speed rule applies to the wind that carries the step
  if (sp0 < uMinSpeed) {                                               // calm or converging: a steady drift, never a random walk (withMinimumSpeed of core.js)
    // this life's own heading: s.w (the lifespan) is fixed for a whole life and new at every respawn. (A heading hashed with uSeed changes every frame:
    // that is a random walk, and the trail recorded it as a tangle of loops in still air.)
    float a = hash22(vUv * 331.7 + vec2(s.w, s.w * .371)).x * 6.2831853;
    float ang = a;
    if (sp0 > 1e-6) { float d = atan(w.y, w.x) - a; ang = a + atan(sin(d), cos(d)) * smoothstep(${WIND_SIM.calmBlend[0].toFixed(3)}, ${WIND_SIM.calmBlend[1].toFixed(3)}, sp0); }   // along the shortest arc
    w = vec2(cos(ang), sin(ang)) * uMinSpeed;
  }
  gl_FragColor = vec4(s.x + w.x * uSim / (111320. * cos(radians(ll.y))) * uO.z, s.y + w.y * uSim / 111320. * uO.w, s.z + uAge, s.w);   // metres to degrees to local km
}`;
// ---- drawing: one tapered streak per particle ----
// The head is the particle's place; the streak lies behind it along the local wind (velocityAt, with the simulation's own calm-air heading) and is STREAK.minPx..maxPx long on
// SCREEN, whatever the zoom: found by projecting a probe point a little behind the head and scaling it. Both ends sit on the terrain (or at the level's height), so the streak
// follows relief; it bends where the wind at its middle points another way (the tail is found by stepping back from the middle along the wind THERE). No history is kept: nothing to smooth, nothing to break when a particle respawns.
const DRAW_VS = GLSL_COMMON + `
attribute vec2 aPart; attribute float aIdx, aSide;                     // particle texel, 0 = head, .5 = middle, 1 = tail, side of the streak
uniform vec2 uViewport; uniform float uPixelRatio, uMinSpeed, uStreak, uWidthScale, uRange, uFromKm, uLevelMix, uFadeA, uExag, uLift, uScale;
uniform sampler2D tState; uniform vec2 uMC;
varying vec3 vCol; varying float vA, vSide, vT;
${windRampGlsl('windRamp')}                                      // windColour of core.js, generated from the same table
vec2 hash22(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973)); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.xx + p3.yz) * p3.zy); }
// A point on the smooth curve through p0 (t = 0), the middle point m (t = .5) and p2 (t = 1): a quadratic Bezier whose control point is chosen so that it passes through m.
vec2 bez(vec2 p0, vec2 m, vec2 p2, float t) { vec2 c = 2. * m - .5 * (p0 + p2); float u = 1. - t; return u * u * p0 + 2. * u * t * c + t * t * p2; }
// Clip-space position of a point lying on the terrain: the height of the drawn MESH at exactly this point plus a hover (or the level height for pressure levels).
vec4 clipAt(vec2 ll) {
  float mx = mercX(ll.x), my = mercY(ll.y), ground = groundDrawM(mx, my) / 1000. * uExag + uLift;
  float lk = uLevelKm; if (lk > 0.) { vec4 g = windGridH(ll); if (g.z > .5 && g.w > 0.) lk = g.w; }     // the level's real height here, else its standard height
  float yTo = lk > 0. ? max(ground, lk * uExag + uLift) : ground;
  float yFrom = uFromKm > 0. ? max(ground, uFromKm * uExag + uLift) : ground;                          // while the level changes: the height the streaks come from
  float y = mix(yFrom, yTo, uLevelMix);
  return projectionMatrix * modelViewMatrix * vec4((mx - uMC.x) * uScale, y, (my - uMC.y) * uScale, 1.);
}
void main() {
  vec4 s = texelFetch(tState, ivec2(aPart), 0);
  vec2 head = vec2(uO.x + s.x / uO.z, uO.y + s.y / uO.w);
  vec3 vh = velocityAt(head);                                          // the wind the simulation sees: terrain adjustment, 1 km wind and the level rules included
  vec2 w = vh.xy; float sp0 = length(w), sp = vh.z > .5 ? sp0 : uMinSpeed;
  if (vh.z < .5 || sp0 < uMinSpeed) {                                  // calm: the heading of this particle's life, as the simulation drifts it (withMinimumSpeed of core.js)
    float a = hash22((aPart + .5) / vec2(${GPU_W}., ${GPU_H}.) * 331.7 + vec2(s.w, s.w * .371)).x * 6.2831853, ang = a;
    if (sp0 > 1e-6) { float d = atan(w.y, w.x) - a; ang = a + atan(sin(d), cos(d)) * smoothstep(${WIND_SIM.calmBlend[0].toFixed(3)}, ${WIND_SIM.calmBlend[1].toFixed(3)}, sp0); }
    w = vec2(cos(ang), sin(ang)) * uMinSpeed;
  }
  vec2 dir = normalize(w);                                             // east, north
  vec2 step1 = dir * vec2(1. / cos(radians(head.y)), 1.);              // one degree of travel along dir, in lon/lat
  vec4 cH = clipAt(head);
  if (cH.w < .01) { gl_Position = vec4(2., 2., 2., 1.); vA = 0.; return; }
  float calm = smoothstep(0., .5, vh.z > .5 ? sp0 : 0.);               // still air: the particle only drifts, so its streak is a short dash (no starbursts)
  float lenPx = ${STREAK.minPx.toFixed(1)} + ${(STREAK.maxPx - STREAK.minPx).toFixed(1)} * smoothstep(0., ${STREAK.fullAtFraction.toFixed(2)}, sp / uRange);
  lenPx *= uStreak * uPixelRatio * mix(.35, 1., calm);
  const float PROBE = .01;                                             // degrees: how far back the probe point is
  vec4 cP = clipAt(head - step1 * PROBE);
  float pxPer = cP.w > .01 ? length((cP.xy / cP.w - cH.xy / cH.w) * uViewport * .5) : 0.;
  float k = pxPer > 1e-4 ? clamp(lenPx / pxPer, 0., 5000.) : 0.;
  vec2 mid = head - step1 * PROBE * k * .5;                            // half way back along the wind at the head
  vec3 vm = velocityAt(mid); vec2 dirM = dir;
  if (vm.z > .5 && length(vm.xy) > .5 * uMinSpeed) dirM = normalize(vm.xy);   // the wind at the middle bends the rest of the streak
  vec2 tail = mid - dirM * vec2(1. / cos(radians(mid.y)), 1.) * PROBE * k * .5;
  vec4 cM = clipAt(mid), cT = clipAt(tail);
  if (cM.w < .01) cM = cH;
  if (cT.w < .01) cT = cM;
  float segPx = max(length((cM.xy / cM.w - cH.xy / cH.w) * uViewport * .5), length((cT.xy / cT.w - cM.xy / cM.w) * uViewport * .5));
  float sane = segPx < lenPx * 1.6 + 4. ? 1. : 0.;                           // a point near the horizon can project very far: such a streak is not drawn
  vec4 c = clipAt(bez(head, mid, tail, aIdx));                          // this vertex's place on the smooth curve (no kinks)
  vec4 cA = clipAt(bez(head, mid, tail, max(aIdx - .06, 0.))), cB = clipAt(bez(head, mid, tail, min(aIdx + .06, 1.)));      // the curve's direction here: from a little before to a little after
  if (c.w < .01 || cA.w < .01 || cB.w < .01) { gl_Position = vec4(2., 2., 2., 1.); vA = 0.; return; }
  vec2 d = (cB.xy / cB.w - cA.xy / cA.w) * uViewport;
  vec2 n = length(d) > 1e-3 ? normalize(vec2(-d.y, d.x)) : vec2(0., 1.);
  float widthPx = uPixelRatio * uWidthScale * (${STREAK.headWidthPx.toFixed(2)} + (${STREAK.tailWidthPx.toFixed(2)} - ${STREAK.headWidthPx.toFixed(2)}) * aIdx);
  c.xy += n * aSide * (widthPx * ${RIBBON.outline.toFixed(2)} / uViewport) * c.w;      // the quad is wider than the coloured core: the rest is the dark edge
  float fadeIn = min(1., s.z / ${STREAK.fadeInFrames.toFixed(1)}), fadeOut = min(1., (s.w - s.z) / ${STREAK.fadeOutFrames.toFixed(1)});
  float lvlFade = 1.;                                                  // a level close to the ground fades out (levelFade of core.js): 300 m above the ground it is fully visible
  if (uLevelKm > 0.) { vec4 g = windGridH(head); float hm = g.z > .5 && g.w > 0. ? g.w * 1000. : uLevelKm * 1000.; lvlFade = clamp((hm - groundM(mercX(head.x), mercY(head.y))) / ${LEVEL_FADE_M.toFixed(1)}, 0., 1.); }
  vA = ${STREAK.alphaHead.toFixed(2)} * fadeIn * fadeOut * lvlFade * uFadeA * sane;
  vCol = mix(windRamp(clamp(sp / uRange, 0., 1.)), vec3(1.), ${STREAK.white.toFixed(2)});        // white (STREAK.white = 1), or tinted by speed when it is lowered
  vSide = aSide; vT = aIdx;
  gl_Position = c;
}`;
const DRAW_FS = `varying vec3 vCol; varying float vA, vSide, vT;
void main() {
  float e = abs(vSide);                                                // 0 on the centre line of the streak, 1 at its outer edge
  float core = 1. - smoothstep(${(RIBBON.core - 0.03).toFixed(2)}, ${(RIBBON.core + 0.03).toFixed(2)}, e);
  float edge = 1. - smoothstep(.94, 1., e);
  vec3 c = mix(vec3(.04, .1, .3), vCol, core);                        // a dark edge round the colour keeps the streaks crisp on bright terrain and snow
  gl_FragColor = vec4(c, vA * pow(1. - vT, ${STREAK.fadePow.toFixed(2)}) * edge * mix(${STREAK.halo.toFixed(2)}, 1., core));       // windRamp and the edge are sRGB values and the canvas takes them as they are
}`;

let simRT = null, simMat = null, drawMat = null, simScene = null, simCam = null;
let smoothR = null;
const drawSize = new THREE.Vector2(), spawnBox = {}, origin = {lon: 0, lat: 0, R: 0, set: false}, prevOrigin = {lon: 0, lat: 0};
function initGpuWind() {
  if (!gpuWind || !sampler || gpuReady) return;
  try {
    const g = sampler.d.grid; wu.uGrid.value.set(g.west, g.south, g.columns, g.rows); wu.uSpacing.value = g.spacing;
    const rtOptions = {type: THREE.FloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false, stencilBuffer: false, generateMipmaps: false};
    simRT = [new THREE.WebGLRenderTarget(GPU_W, GPU_H, rtOptions), new THREE.WebGLRenderTarget(GPU_W, GPU_H, rtOptions)];
    simCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    simMat = new THREE.ShaderMaterial({
      uniforms: {...wu, tState: {value: simRT[0].texture}, uSim: {value: 0}, uAge: {value: 1}, uSeed: {value: 0}, uReset: {value: 1}, uMinSpeed: {value: WIND_SIM.minSpeed}, uRebase: {value: 0}, uOold: {value: new THREE.Vector4(g.west, g.south, 100, 111.19)},
        uScreenShare: {value: 0.9}, uScale: {value: SCALE}, uMC: {value: new THREE.Vector2(MXC, MYC)}, uSpawnPlane: {value: new THREE.Vector4()},
        uInvProj: {value: camera.projectionMatrixInverse}, uCamWorld: {value: camera.matrixWorld}, uCamPos: {value: camera.position},
        uSpawn: {value: new THREE.Vector4(g.west, g.east, g.south, g.north)}, uBox: {value: new THREE.Vector4(g.west, g.east, g.south, g.north)}, uView: {value: new THREE.Vector3(0, 0, 2500)}, uLife: {value: new THREE.Vector2(WIND_SIM.life[0], WIND_SIM.life[1])}},
      vertexShader: SIM_VS, fragmentShader: SIM_FS, depthTest: false, depthWrite: false});
    simScene = new THREE.Scene(); simScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), simMat));
    // (STREAK.segments + 1) points x 2 sides per particle and two triangles per segment; aIdx runs from 0 at the head to 1 at the tail along the curve
    const SEG = STREAK.segments, VP = (SEG + 1) * 2, part = new Float32Array(GPU_N * VP * 2), idx = new Float32Array(GPU_N * VP), side = new Float32Array(GPU_N * VP), index = new Uint32Array(GPU_N * SEG * 6);
    for (let i = 0; i < GPU_N; i++) {
      const px = i % GPU_W, py = Math.floor(i / GPU_W), b = VP * i;
      for (let k = 0; k < VP; k++) { part[2 * (b + k)] = px; part[2 * (b + k) + 1] = py; idx[b + k] = (k >> 1) / SEG; side[b + k] = k % 2 ? 1 : -1; }
      for (let s = 0; s < SEG; s++) { const v = b + 2 * s; index.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], (i * SEG + s) * 6); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(GPU_N * VP * 3), 3)); geo.setAttribute('aPart', new THREE.BufferAttribute(part, 2));
    geo.setAttribute('aIdx', new THREE.BufferAttribute(idx, 1)); geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1)); geo.setIndex(new THREE.BufferAttribute(index, 1));
    drawMat = new THREE.ShaderMaterial({
      uniforms: {...wu, tState: {value: simRT[0].texture}, uExag: {value: state.exag}, uLift: {value: 0.1}, uScale: {value: SCALE}, uViewport: {value: new THREE.Vector2(1, 1)}, uPixelRatio: {value: 1},
        uRange: {value: WIND_RANGES.sfc}, uFromKm: {value: 0}, uLevelMix: {value: 1}, uFadeA: {value: 1}, uMinSpeed: {value: WIND_SIM.minSpeed}, uStreak: {value: 1}, uWidthScale: {value: 1}, uMC: {value: new THREE.Vector2(MXC, MYC)}},
      vertexShader: DRAW_VS, fragmentShader: DRAW_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide});
    gpuLines = new THREE.Mesh(geo, drawMat); gpuLines.frustumCulled = false; gpuLines.renderOrder = 20; scene.add(gpuLines);
    windLines.visible = false; gpuReady = true; resetNext = true; syncWindLevels();
  } catch (e) { gpuReady = false; console.warn('GPU wind unavailable, using the CPU simulation:', e.message); }
}
// ---- changing the wind level (E6) and the reference grid at a pressure level (E8) ----
// transitionAt of core.js: the old trails fade out, then the level is switched (commitLevel) and the new trails fade in while the drawn height moves from the old level's height
// (the ground at the surface) to the new one. Only the drawing is changed (uFromKm, uLevelMix, uFadeA); the simulation never sees any of it.
const trans = {active: false, committed: true, t: 0, from: 'sfc', to: 'sfc', fromKm: 0};
function tickLevelChange(dt) {
  if (!trans.active) return {fromKm: 0, mix: 1, alpha: 1};
  trans.t += dt;
  const x = transitionAt(trans.t);
  if (x.phase === 'in' && !trans.committed) commitLevel(trans.to);
  if (x.done) { trans.active = false; return {fromKm: 0, mix: 1, alpha: 1}; }
  return x.phase === 'out' ? {fromKm: 0, mix: 1, alpha: x.alpha} : {fromKm: trans.fromKm, mix: x.mix, alpha: x.alpha};
}
function finishLevelChange() { if (trans.active && !trans.committed) commitLevel(trans.to); trans.active = false; }
// A faint white grid at the level's drawn height (its standard height times the exaggeration plus the hover): 1 degree lines, plus 0.25 degree lines when the view is under 150 km wide.
// In the Mercator scene a parallel or a meridian is a straight line, so the lines are plain two-vertex segments; the geometry sits at y = 0 and the mesh is raised each frame.
let levelGrid = null, gridKey = '';
function updateLevelGrid(lon, lat, R, dist, tr) {
  const lvl = WIND_LEVELS[state.level], on = state.layers.has('w') && lvl.hPa !== null;
  if (!on) { if (levelGrid) levelGrid.visible = false; return; }
  if (!levelGrid) {
    levelGrid = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({color: 0xffffff, transparent: true, depthWrite: false}));
    levelGrid.frustumCulled = false; levelGrid.renderOrder = 15; scene.add(levelGrid);
  }
  const spacings = gridSpacings(2 * R), step = spacings.at(-1), cx = Math.round(lon / step) * step, cy = Math.round(lat / step) * step;
  const hLat = R * 1.4 / 111.19 + step, hLon = R * 1.4 / (111.19 * Math.max(0.2, Math.cos(lat * Math.PI / 180))) + step, key = [spacings.length, cx, cy, Math.ceil(hLat / step)].join('|');
  if (key !== gridKey) {
    gridKey = key;
    const pos = [], x = lo => (mercX(lo) - MXC) * SCALE, z = la => (mercY(la) - MYC) * SCALE, za = z(cy - hLat), zb = z(cy + hLat), xa = x(cx - hLon), xb = x(cx + hLon);
    spacings.forEach((sp, k) => {
      const skip = v => k > 0 && Math.abs(v / spacings[0] - Math.round(v / spacings[0])) < 1e-6;           // the 1 degree lines are drawn once
      for (let lo = Math.ceil((cx - hLon) / sp) * sp; lo <= cx + hLon; lo += sp) if (!skip(lo)) pos.push(x(lo), 0, za, x(lo), 0, zb);
      for (let la = Math.ceil((cy - hLat) / sp) * sp; la <= cy + hLat; la += sp) if (!skip(la)) pos.push(xa, 0, z(la), xb, 0, z(la));
    });
    levelGrid.geometry.dispose(); levelGrid.geometry = new THREE.BufferGeometry(); levelGrid.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  }
  levelGrid.visible = true;
  levelGrid.position.y = (tr.fromKm + (lvl.heightKm - tr.fromKm) * tr.mix) * state.exag + Math.min(2.5, Math.max(0.05, dist * 0.0012));
  levelGrid.material.opacity = gridOpacity(dist, tr.alpha);
}
// ---- the Pakistan boundary: a black line draped on the terrain ----
// Drawn like the streaks: each segment is a screen-space quad whose ends sit on the drawn terrain (groundDrawM) plus a hover, so it follows relief at every zoom. Needs the same
// vertex textures as the wind drawing; without them (an old GPU) it is simply not drawn.
const BOUNDARY_VS = GLSL_COMMON + `
attribute vec2 aA, aB; attribute float aEnd, aSide;
uniform vec2 uViewport, uMC; uniform float uPixelRatio, uExag, uLift, uScale;
varying float vSide;
vec4 clipAt(vec2 ll) {
  float mx = mercX(ll.x), my = mercY(ll.y), ground = groundDrawM(mx, my) / 1000. * uExag + uLift;
  return projectionMatrix * modelViewMatrix * vec4((mx - uMC.x) * uScale, ground, (my - uMC.y) * uScale, 1.);
}
void main() {
  vec4 cA = clipAt(aA), cB = clipAt(aB);
  if (cA.w < .01 || cB.w < .01) { gl_Position = vec4(2., 2., 2., 1.); vSide = 0.; return; }
  vec4 c = aEnd < .5 ? cA : cB;
  vec2 d = (cB.xy / cB.w - cA.xy / cA.w) * uViewport;
  vec2 n = length(d) > 1e-4 ? normalize(vec2(-d.y, d.x)) : vec2(0., 1.);
  c.xy += n * aSide * (${BOUNDARY.haloHalfPx.toFixed(2)} * uPixelRatio / uViewport) * c.w;
  vSide = aSide; gl_Position = c;
}`;
const BOUNDARY_FS = `varying float vSide;
void main() {
  float e = abs(vSide);
  float core = 1. - smoothstep(${(BOUNDARY.coreHalfPx / BOUNDARY.haloHalfPx - 0.06).toFixed(2)}, ${(BOUNDARY.coreHalfPx / BOUNDARY.haloHalfPx + 0.06).toFixed(2)}, e);
  float edge = 1. - smoothstep(.9, 1., e);
  gl_FragColor = vec4(mix(vec3(1.), vec3(0.), core), edge * mix(${BOUNDARY.haloAlpha.toFixed(2)}, 1., core));       // a black line with a thin white halo so it also shows on dark ground
}`;
let boundaryMesh = null;
async function initBoundary() {
  if (!gpuWind || boundaryMesh) return;
  try {
    const r = await fetch('pakistan-boundary.json'); if (!r.ok) return;
    const segs = boundarySegments((await r.json()).rings), n = segs.length;
    const aA = new Float32Array(n * 8), aB = new Float32Array(n * 8), aEnd = new Float32Array(n * 4), aSide = new Float32Array(n * 4), index = new Uint32Array(n * 6);
    segs.forEach(([x0, y0, x1, y1], i) => {
      const b = 4 * i;
      for (let k = 0; k < 4; k++) { aA.set([x0, y0], 2 * (b + k)); aB.set([x1, y1], 2 * (b + k)); aEnd[b + k] = k >> 1; aSide[b + k] = k % 2 ? 1 : -1; }
      index.set([b, b + 1, b + 2, b + 1, b + 3, b + 2], 6 * i);
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 12), 3)); geo.setAttribute('aA', new THREE.BufferAttribute(aA, 2)); geo.setAttribute('aB', new THREE.BufferAttribute(aB, 2));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(aEnd, 1)); geo.setAttribute('aSide', new THREE.BufferAttribute(aSide, 1)); geo.setIndex(new THREE.BufferAttribute(index, 1));
    const mat = new THREE.ShaderMaterial({uniforms: {...wu, uViewport: {value: new THREE.Vector2(1, 1)}, uPixelRatio: {value: 1}, uExag: {value: state.exag}, uLift: {value: 0.1}, uScale: {value: SCALE}, uMC: {value: new THREE.Vector2(MXC, MYC)}},
      vertexShader: BOUNDARY_VS, fragmentShader: BOUNDARY_FS, transparent: true, depthWrite: false, side: THREE.DoubleSide});
    boundaryMesh = new THREE.Mesh(geo, mat); boundaryMesh.frustumCulled = false; boundaryMesh.renderOrder = 12; scene.add(boundaryMesh);
  } catch (e) { console.warn('Pakistan boundary unavailable:', e.message); }
}
function updateBoundary() {
  if (!boundaryMesh) return;
  boundaryMesh.visible = state.border;
  const u = boundaryMesh.material.uniforms, dist = camera.position.distanceTo(controls.target);
  u.uExag.value = state.exag; u.uLift.value = Math.min(3.5, Math.max(0.1, dist * 0.0018));
  renderer.getDrawingBufferSize(drawSize); u.uViewport.value.copy(drawSize); u.uPixelRatio.value = renderer.getPixelRatio();
}
function stepWindGpu(dt) {
  const dist = camera.position.distanceTo(controls.target), scale = zoomScale(dist), Rraw = Math.min(2500, Math.max(25, dist * 1.15)), g = sampler.d.grid;
  smoothR = smoothR === null ? Rraw : smoothR + (Rraw - smoothR) * (1 - Math.exp(-dt / 0.15));       // eased: a fast zoom changes the spawn and recycle radius smoothly, not all at once
  const R = smoothR;
  updateWindTextures();
  const lon = lonOfX(controls.target.x / SCALE + MXC), lat = latOfY(controls.target.z / SCALE + MYC);
  respawnBox(lon, lat, R, g, spawnBox);
  const su = simMat.uniforms;
  camera.updateMatrixWorld();                                          // the spawn rays use this frame's camera, not the last render's
  const lift = Math.min(2.5, Math.max(0.05, dist * 0.0012));
  const tr = tickLevelChange(dt);                                      // may switch the level half way through a level change
  su.uSpawnPlane.value.set(spawnPlaneHeight(state.level, sceneHeightAt(controls.target.x, controls.target.z), state.exag, lift), controls.target.x, controls.target.z, 1.5 * R);
  // The origin stays where it is until the view has moved a third of its radius away or zoomed in a lot, then particles are re-based onto the new one.
  const kx0 = 111.19 * Math.cos(origin.lat * Math.PI / 180);
  let rebase = false;
  if (!origin.set || Math.hypot((lon - origin.lon) * kx0, (lat - origin.lat) * 111.19) > 0.3 * R || R < 0.4 * origin.R) {
    if (origin.set) { prevOrigin.lon = origin.lon; prevOrigin.lat = origin.lat; } else { prevOrigin.lon = lon; prevOrigin.lat = lat; }
    origin.lon = lon; origin.lat = lat; origin.R = R; origin.set = true; rebase = true;
  }
  const kx = 111.19 * Math.cos(origin.lat * Math.PI / 180);
  wu.uO.value.set(origin.lon, origin.lat, kx, 111.19); su.uOold.value.set(prevOrigin.lon, prevOrigin.lat, 111.19 * Math.cos(prevOrigin.lat * Math.PI / 180), 111.19); su.uRebase.value = rebase ? 1 : 0;
  su.uSpawn.value.set(spawnBox.west, spawnBox.east, spawnBox.south, spawnBox.north); su.uView.value.set((lon - origin.lon) * kx, (lat - origin.lat) * 111.19, R);
  const motion = windMotion(state.level);
  su.uSim.value = dt * WIND_SIM.simSeconds * state.speed * scale * motion; su.uAge.value = dt * 60; su.uSeed.value = (++simFrame * 0.7548776662) % 997;
  wu.uSurface.value = state.level === 'sfc' ? 1 : 0; wu.uFollow.value = state.follow ? 1 : 0;
  wu.u1kBlend.value = km1.m ? wind1kmWeight(state.hour, km1.m.hours.at(-1)) : 1;
  const fullReset = resetNext;
  su.uReset.value = fullReset ? 1 : 0; resetNext = false;
  su.tState.value = simRT[simCur].texture;
  const next = 1 - simCur;
  // only the particles that are drawn are simulated: a scissor on the first rows of the state texture (the viewport stays whole, so every texel still reads its own place)
  const drawn = Math.floor(Math.min(state.density * Math.max(QUALITY_STEPS[quality.level].trails, STREAK_KEEP), GPU_N)), {rows, activate} = simRowRange(drawn, GPU_W, GPU_H, fullReset ? 0 : activeRows);
  const limit = (rt, y0, y1) => { rt.scissor.set(0, y0, rt.width, y1 - y0); rt.scissorTest = y1 - y0 < rt.height; };
  limit(simRT[next], 0, rows); renderer.setRenderTarget(simRT[next]); renderer.render(simScene, simCam);
  if (activate) { limit(simRT[next], activate[0], activate[1]); su.uReset.value = 1; renderer.render(simScene, simCam); su.uReset.value = 0; }      // rows that were idle start afresh
  activeRows = rows;
  simCur = next;
  renderer.setRenderTarget(null);
  const du = drawMat.uniforms;
  du.tState.value = simRT[simCur].texture; du.uStreak.value = lengthControl(state.trailSegs); du.uWidthScale.value = state.widthScale;
  du.uRange.value = windRange(state.level, state.sfcRange); du.uFromKm.value = tr.fromKm; du.uLevelMix.value = tr.mix; du.uFadeA.value = tr.alpha; du.uExag.value = state.exag; du.uLift.value = lift; du.uLevelKm.value = WIND_LEVELS[state.level].heightKm;
  renderer.getDrawingBufferSize(drawSize); du.uViewport.value.copy(drawSize); du.uPixelRatio.value = renderer.getPixelRatio();
  gpuLines.geometry.setDrawRange(0, drawn * STREAK.segments * 6);
  updateLevelGrid(lon, lat, R, dist, tr);
}

// ---- ray against the height field (fast, and exact enough for a click) ----
function groundPoint(clientX, clientY) {
  const r = canvas.getBoundingClientRect(), ndc = new THREE.Vector2((clientX - r.left) / r.width * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
  const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, camera);
  const o = ray.ray.origin, d = ray.ray.direction, inside = t => { const x = o.x + d.x * t, y = o.y + d.y * t, z = o.z + d.z * t; return {x, y, z, below: y < sceneHeightAt(x, z)}; };
  const dist = camera.position.distanceTo(controls.target), stepKm = Math.max(0.5, dist / 400);
  let prev = 0;
  for (let t = 0; t < 12000; t += stepKm) {
    if (inside(t).below) {
      let lo = prev, hi = t;
      for (let k = 0; k < 16; k++) { const mid = (lo + hi) / 2; inside(mid).below ? hi = mid : lo = mid; }
      const p = inside(hi), [lon, lat] = toLonLat(p.x, p.z);
      return lon >= GRID.west && lon <= GRID.east && lat >= GRID.south && lat <= GRID.north ? {lon, lat, x: p.x, y: p.y, z: p.z} : null;
    }
    prev = t;
  }
  return null;
}

// ---- place and peak labels (GeoNames, tiered by scripts/sync-terrain-labels.py) ----
// Tier t is shown while the camera is closer than maxDistKm[t]; labels never overlap, and the most important (lowest tier) are placed first, so
// the country view shows a few big names and a close view shows towns, villages, peaks and passes.
const labelBox = $('labels'), DEFAULT_TIERS = [6000, 2600, 1300, 650, 260, 90], labelPool = [];
// Until GeoNames loads (or if it cannot): the portal's list of 86 cities as tier 2.
let labels = Object.values(cities).map(([name, lat, lon]) => [name, lat, lon, 2, 'c', null]), labelTiers = DEFAULT_TIERS;
let labelCells = labelIndex(labels), townList = labels.map(l => ({name: l[0], lat: l[1], lon: l[2]}));
async function loadLabels() {
  try {
    const r = await fetch('../terrain-data/labels-pk.json');
    if (!r.ok) return;
    const d = await r.json();
    if (!Array.isArray(d.labels) || !d.labels.length) return;
    labels = d.labels; labelTiers = Array.isArray(d.maxDistKm) ? d.maxDistKm : DEFAULT_TIERS; labelCells = labelIndex(labels);
    townList = labels.filter(l => l[4] !== 'p' && l[4] !== 's' && l[3] <= 4).map(l => ({name: l[0], lat: l[1], lon: l[2]}));
  } catch { /* the 86 cities stay */ }
}
const labelText = l => l[4] === 'p' ? `▲ ${l[0]}${l[5] ? ' ' + l[5] + ' m' : ''}` : l[4] === 's' ? `⌃ ${l[0]}` : l[0];
function labelElement() { const el = document.createElement('span'); el.hidden = true; labelBox.appendChild(el); return el; }
function placeLabels() {
  if (!state.layers.has('c')) { for (const el of labelPool) el.hidden = true; return; }
  const dist = camera.position.distanceTo(controls.target), maxTier = maxTierFor(dist, labelTiers), [lon, lat] = toLonLat(controls.target.x, controls.target.z);
  const w = canvas.clientWidth, h = canvas.clientHeight, v = new THREE.Vector3(), boxes = [];
  let used = 0;
  for (const i of labelsNear(labels, labelCells, lon, lat, Math.min(3000, dist * 1.4 + 20), maxTier)) {
    if (used >= 170) break;
    const l = labels[i], [x, z] = toScene(l[2], l[1]);
    v.set(x, sceneHeightAt(x, z) + 1.5, z).project(camera);
    if (v.z >= 1 || Math.abs(v.x) > 1.02 || Math.abs(v.y) > 1.02) continue;
    const px = (v.x * 0.5 + 0.5) * w, py = (-v.y * 0.5 + 0.5) * h, text = labelText(l), bw = text.length * (l[3] <= 1 ? 7.2 : 6.2) + 10, bh = 17, bx = px - bw / 2, by = py - bh;
    let clash = false;
    for (const b of boxes) if (bx < b[0] + b[2] && bx + bw > b[0] && by < b[1] + b[3] && by + bh > b[1]) { clash = true; break; }
    if (clash) continue;
    boxes.push([bx, by, bw, bh]);
    const el = labelPool[used] || (labelPool[used] = labelElement());
    el.hidden = false;
    if (el._text !== text) { el.textContent = text; el._text = text; }
    const cls = `k-${l[4]} t${Math.min(l[3], 5)}`;
    if (el._cls !== cls) { el.className = cls; el._cls = cls; }
    el.style.left = px + 'px'; el.style.top = py + 'px';
    used++;
  }
  for (let i = used; i < labelPool.length; i++) labelPool[i].hidden = true;
}

// ---- station readings, the 1 km model and the difference at every pin ----
// Switched on in the Layers list: the temperature of every WeatherWalay and PMD station and METAR airport that has reported in the last 3 hours, as the reading, the 1 km model value at
// that place and that reading time, or their difference. The model is nudged toward fresh stations, so at an active station the difference is what remains after assimilation; the
// reading is not adjusted to the height of the 1 km cell. Temperature only. The model exists on the local server only: on the published site only the readings are shown.
const pinBox = $('pins'), pinPool = [], obsData = {pins: [], steps: new Map(), loading: new Set(), realtime: null, metar: null, timer: 0};
function attachPinModel() {
  for (const p of obsData.pins) { p.model = km1.m ? modelTemperature(km1.m, obsData.steps, p.lon, p.lat, p.tMs) : null; p.bias = p.model !== null && Number.isFinite(p.value) ? p.value - p.model : null; }
}
async function loadObsStep(i) {
  if (obsData.steps.has(i) || obsData.loading.has(i) || !km1.m) return;
  obsData.loading.add(i);
  try {
    const bmp = await load1km(km1.m.steps[i].tr);                                                    // the same image the terrain shader draws, read here for the numbers
    const c2 = new OffscreenCanvas(bmp.width, bmp.height).getContext('2d', {willReadFrequently: true}); c2.drawImage(bmp, 0, 0);
    const px = c2.getImageData(0, 0, bmp.width, bmp.height).data, grid = new Float32Array(bmp.width * bmp.height);
    for (let k = 0; k < grid.length; k++) grid[k] = decodeTempPixel(px[4 * k], px[4 * k + 1], px[4 * k + 2]);
    obsData.steps.set(i, {grid, nx: bmp.width, ny: bmp.height}); bmp.close?.();
    while (obsData.steps.size > 4) obsData.steps.delete(obsData.steps.keys().next().value);
  } catch { /* the pins that need this step show no model value */ } finally { obsData.loading.delete(i); }
}
async function ensureObsSteps() {
  if (!state.obs || !km1.m || state.obsMode === 'obs') return;
  const missing = [...stepsNeeded(km1.m, obsData.pins.map(p => p.tMs))].filter(i => !obsData.steps.has(i));
  if (!missing.length) return;
  await Promise.all(missing.map(loadObsStep)); attachPinModel();
}
async function refreshObs() {
  const [rt, mt] = await Promise.allSettled([fetchFeed('realtime'), fetchFeed('metar')]);
  if (rt.status === 'fulfilled') obsData.realtime = rt.value;
  if (mt.status === 'fulfilled') obsData.metar = mt.value;
  obsData.pins = obsPins(obsData.realtime, obsData.metar, parseLabel); attachPinModel(); ensureObsSteps();
  $('obs-note').textContent = obsData.pins.length ? `${obsData.pins.length} stations, PMD and airports reported in the last 3 hours.` + (km1.m ? ' The 1 km model is nudged toward fresh stations, so the difference is what remains after assimilation; readings are not height-adjusted to the 1 km cell.' : ' The 1 km model is not available here: only the readings are shown.') : 'No recent station readings are available.';
}
function setObs(on) {
  state.obs = on; $('obs-modes').hidden = !on; $('obs-note').hidden = !on; clearInterval(obsData.timer);
  if (on) { refreshObs(); obsData.timer = setInterval(() => { if (!document.hidden) refreshObs(); }, 60000); } else for (const el of pinPool) el.hidden = true;
}
function pinText(p) {
  const mode = km1.m ? state.obsMode : 'obs';
  if (mode === 'obs') return {text: p.value.toFixed(1), color: '#ffffff'};
  if (p.model === null || p.model === undefined) return null;
  return mode === 'fcst' ? {text: p.model.toFixed(1), color: '#d6ecff'} : {text: fmtBias(p.bias), color: biasColour(p.bias)};
}
function placePins() {
  if (!state.obs || !obsData.pins.length) { for (const el of pinPool) el.hidden = true; return; }
  const w = canvas.clientWidth, h = canvas.clientHeight, v = new THREE.Vector3(), taken = new Set();
  let used = 0;
  for (const p of obsData.pins) {                                                                    // active stations first, so a fresh reading is never hidden by an old one
    if (used >= 400) break;
    const lab = pinText(p); if (!lab) continue;
    const [x, z] = toScene(p.lon, p.lat);
    v.set(x, sceneHeightAt(x, z) + 1.2, z).project(camera);
    if (v.z >= 1 || Math.abs(v.x) > 1.02 || Math.abs(v.y) > 1.02) continue;
    const px = (v.x * 0.5 + 0.5) * w, py = (-v.y * 0.5 + 0.5) * h, cell = `${Math.floor(px / 34)},${Math.floor(py / 20)}`;
    if (taken.has(cell)) continue;
    taken.add(cell);
    const el = pinPool[used] || (pinPool[used] = (() => { const e = document.createElement('span'); e.hidden = true; pinBox.appendChild(e); return e; })());
    el.hidden = false; el.style.left = px + 'px'; el.style.top = py + 'px'; el.style.opacity = p.active ? '1' : '0.6';
    if (el._text !== lab.text) { el.textContent = lab.text; el._text = lab.text; }
    if (el._color !== lab.color) { el.style.color = lab.color; el._color = lab.color; }
    const tip = `${p.name} (${p.network}): observed ${p.value.toFixed(1)} °C` + (p.model !== null && p.model !== undefined ? `, 1 km model ${p.model.toFixed(1)} °C, obs - model ${fmtBias(p.bias)} °C` : '') + (p.active ? '' : ' · older reading');
    if (el._tip !== tip) { el.title = tip; el._tip = tip; }
    used++;
  }
  for (let i = used; i < pinPool.length; i++) pinPool[i].hidden = true;
}
$('l-obs').addEventListener('change', e => setObs(e.target.checked));
document.querySelectorAll('#obs-modes button').forEach(b => b.addEventListener('click', () => {
  state.obsMode = b.dataset.mode; document.querySelectorAll('#obs-modes button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); ensureObsSteps();
}));

// ---- time ----
const fmtDay = new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Karachi', weekday: 'short', day: 'numeric', month: 'short'});
const fmtHour = new Intl.DateTimeFormat('en-GB', {timeZone: 'Asia/Karachi', hour: '2-digit', minute: '2-digit', hour12: false});
function updateTimeLabel() {
  if (!data) { $('t-label').textContent = 'No forecast data'; return; }
  const ms = Date.parse(data.times[0]) + state.hour * 3600000;
  $('t-label').textContent = `${fmtDay.format(ms)} · ${fmtHour.format(ms)}`;
  const age = (Date.now() - Date.parse(data.retrieved_at)) / 3600000;
  $('t-sub').textContent = `PKT · data fetched ${age < 1 ? 'under 1 h' : Math.round(age) + ' h'} ago`;
  $('t-slider').value = state.hour;
}
function setHour(h) { state.hour = Math.min(Math.max(h, 0), sampler?.lastHour ?? 71); updateTimeLabel(); updateCursor(); saveHash(); }
const nowHour = () => { const h = sampler?.hourOf(Date.now()); return h === null || h === undefined ? null : h; };

// ---- share view ----
let hashTimer = 0;
function saveHash() {
  clearTimeout(hashTimer);
  hashTimer = setTimeout(() => { try { history.replaceState(null, '', encodeView({...readView(), exag: state.exag, hour: state.hour, layers: [...state.layers], level: state.level})); } catch { /* sandboxed frame */ } }, 250);
}

// ---- 1 km step loading ----
const IMG_OPTS = {premultiplyAlpha: 'none', colorSpaceConversion: 'none'};       // the bytes are data, not colours
async function load1km(path) {
  const r = await fetch('../terrain-data/grid-1km/' + path);
  if (!r.ok) throw Error(path + ': ' + r.status);
  return createImageBitmap(await r.blob(), IMG_OPTS);
}
function dataTexture(bitmap) {
  const t = new THREE.Texture(bitmap);
  Object.assign(t, {flipY: false, generateMipmaps: false, premultiplyAlpha: false, magFilter: THREE.NearestFilter, minFilter: THREE.NearestFilter, colorSpace: THREE.NoColorSpace});
  t.needsUpdate = true; return t;
}
// The 99th percentile of the 1 km surface wind speed over the steps loaded so far (a histogram in 0.1 m/s bins, each step counted once): when it is above the default 20 m/s the
// surface colour range becomes it rounded up to the next 5 m/s (surfaceRangeFrom of core.js).
const speedHist = new Float64Array(1000), speedCounted = new Set();
function countWindSpeeds(bitmap, i) {
  if (speedCounted.has(i)) return;
  speedCounted.add(i);
  try {
    const c = new OffscreenCanvas(bitmap.width, bitmap.height), x = c.getContext('2d', {willReadFrequently: true}); x.drawImage(bitmap, 0, 0);
    const d = x.getImageData(0, 0, c.width, c.height).data;
    for (let k = 0; k < d.length; k += 4) { const sp = windSpeedFromCode(d[k], d[k + 1], d[k + 2]); if (sp !== null) speedHist[Math.min(999, Math.floor(sp * 10))]++; }
    km1.p99 = histogramPercentile(speedHist, 0.1, 0.99);
    const r = surfaceRangeFrom(km1.p99);
    if (r !== state.sfcRange) { state.sfcRange = r; console.info(`surface wind range ${r} m/s (99th percentile of the 1 km surface wind: ${km1.p99.toFixed(1)} m/s, ${speedCounted.size} steps)`); updateWindLegend(); }
  } catch { /* no canvas: the default range stays */ }
}
// Step i's textures, or null while they load. The six most recently used steps are kept (about 65 MB of GPU memory at most).
function km1Step(i) {
  const hit = km1.tex.get(i);
  if (hit) { km1.tex.delete(i); km1.tex.set(i, hit); return hit; }
  if (!km1.loading.has(i)) km1.loading.set(i, Promise.all([load1km(km1.m.steps[i].tr), load1km(km1.m.steps[i].wind), km1.phase ? load1km(km1.m.steps[i].phase) : null]).then(([a, b, c]) => {
    countWindSpeeds(b, i);
    km1.tex.set(i, {tr: dataTexture(a), w: dataTexture(b), ph: c ? dataTexture(c) : null}); km1.loading.delete(i);
    while (km1.tex.size > 6) { const [k, old] = km1.tex.entries().next().value; km1.tex.delete(k); for (const t of [old.tr, old.w, old.ph]) { if (t) { t.dispose(); t.image.close?.(); } } }
  }).catch(() => { km1.loading.delete(i); km1.failed++; }));
  return null;
}
// Every frame: point the shaders at the two steps around the hour (the previous pair stays until the new one is in) and fetch the next step.
function update1km() {
  if (!km1.m || !sampler || km1.failed > 4) return;
  const seg = sampler.segment(state.hour);
  if (seg.i1 >= km1.m.steps.length) {                                    // past the last 1 km step: the 9 km grid draws temperature and rain, the slope rule the wind
    if (km1.on) { km1.on = false; apply1kmFlags(); paintOverlay(true); }
    return;
  }
  const a = km1Step(seg.i0), b = km1Step(seg.i1);
  if (a && b) {
    ku.tTrA.value = a.tr; ku.tTrB.value = b.tr; if (a.ph && b.ph) { ku.tPhA.value = a.ph; ku.tPhB.value = b.ph; } ku.tW1A.value = a.w; ku.tW1B.value = b.w; ku.u1kMix.value = seg.w;
    if (seg.i1 + 1 < km1.m.steps.length) km1Step(seg.i1 + 1);
    if (!km1.on) { km1.on = true; km1.ready = true; apply1kmFlags(); paintOverlay(true); }
  }
}
function apply1kmFlags() {
  ku.u1kTemp.value = km1.on && state.layers.has('t') && state.level === 'sfc' ? 1 : 0; ku.u1kRain.value = km1.on && state.layers.has('r') ? 1 : 0; ku.u1kSnow.value = km1.on && km1.phase && state.layers.has('s') ? 1 : 0; ku.u1kPhase.value = km1.phase ? 1 : 0; ku.u1kWind.value = km1.on ? 1 : 0;
}
// ---- newer data while the page stays open ----
// A local server (node server.js) refreshes the files behind this page in the background (scripts/dev-refresh.mjs) and says when they changed (/api/refresh-status: file stamps).
// Polled every 5 minutes: a hidden tab reloads itself, a visible one shows a small bar with a Reload button, so the view is never pulled away. The reload keeps the view (the
// address holds it) and moves to the current hour. Without that endpoint (the published site) nothing is watched.
const NEW_DATA_POLL_MS = 5 * 60000;
async function dataStamp() {
  try { const r = await fetch('../api/refresh-status', {cache: 'no-store'}); if (!r.ok) return null; const j = await r.json(); return j.data ? JSON.stringify([j.data.grid, j.data.km1]) : null; } catch { return null; }
}
const stampAtLoad = dataStamp();                                                                  // asked before anything else is loaded
const reloadedForNewData = (() => { try { const f = sessionStorage.getItem('explorer-reload-now'); sessionStorage.removeItem('explorer-reload-now'); return f === '1'; } catch { return false; } })();
function reloadForNewData() { try { sessionStorage.setItem('explorer-reload-now', '1'); } catch { /* no storage: the hour stays */ } location.reload(); }
function showNewDataBar() {
  if ($('new-data')) return;
  const bar = document.createElement('div'), btn = document.createElement('button');
  bar.id = 'new-data'; bar.setAttribute('role', 'status');
  bar.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:50;display:flex;gap:10px;align-items:center;padding:8px 12px 8px 14px;border-radius:10px;background:#1d3557;color:#fff;font:13px/1.3 system-ui,sans-serif;box-shadow:0 4px 18px #0006';
  btn.textContent = 'Reload'; btn.style.cssText = 'font:inherit;padding:4px 10px;border-radius:7px;border:0;background:#fff;color:#1d3557;cursor:pointer';
  btn.addEventListener('click', reloadForNewData);
  bar.append('New forecast data is ready.', btn); document.body.appendChild(bar);
}
async function watchNewData() {
  const loaded = await stampAtLoad;
  if (!loaded) return;
  setInterval(async () => { const now = await dataStamp(); if (!now || now === loaded) return; if (document.hidden) reloadForNewData(); else showNewDataBar(); }, NEW_DATA_POLL_MS);
}
async function init1km() {
  try {
    const r = await fetch('../terrain-data/grid-1km/manifest.json', {cache: 'no-cache'});
    if (!r.ok) return;
    const m = await r.json();
    if (!validManifest(m, data?.run, sampler?.hours.length ?? -1, sampler?.hours)) return;
    km1.m = m; km1.phase = hasPhase(m); ku.u1kBox.value.set(m.grid.west, m.grid.north, m.grid.res, 0);
    const a = m.assimilation || {}, n = a.used ? a.stations : 0, cv = (m.model?.cv_all_stations || []).map(c => `${c.target} RMSE ${c.rmse_raw.toFixed(1)} -> ${c.rmse_1km.toFixed(1)}`).join('; ');
    const badge = $('ml-badge');
    badge.textContent = `1 km ML downscaled (PMD + ECMWF) · ${n ? n + ' live stations assimilated' : 'no live stations'}`;
    badge.title = [`Temperature, rain and 10 m wind at 1 km: LightGBM + CatBoost trained on ${m.model?.stations ?? '?'} PMD stations against ERA5-Land, applied to ECMWF run ${m.run.slice(0, 13).replace('T', ' ')} UTC.`,
      a.used ? `Live stations (realtime.json, all networks${a.by_source?.metar ? ' + METAR' : ''}) at ${a.analysis_time.slice(11, 16)} UTC nudge the field, fading over ${a.decay_hours} h.` : 'No fresh station readings: no live nudging.',
      'Wind made mass-consistent over the 1 km GLO-90 terrain.', km1.phase ? 'Rain, sleet and snow are split at 1 km from wet-bulb temperature, humidity and height (Ding et al. 2014, fitted to daily data in China; sleet shown half rain, half snow); not validated against snow observations, and unheated gauges miss snow. Screening only.' : '', cv ? 'Unseen-station check (ERA5-Land): ' + cv + '.' : '', 'Screening only, not an official forecast.'].filter(Boolean).join('\n');
    badge.hidden = false;
    $('subtitle').textContent = 'ECMWF IFS 9 km, downscaled to 1 km';
    $('credit-forecast').textContent += ' · 1 km: ML models trained on PMD stations and ERA5-Land (Copernicus), Copernicus DEM GLO-90, live WeatherWalay stations' + (km1.phase ? ' · rain / snow split: Ding et al. (2014)' : '');
  } catch { /* the 9 km view stays */ }
}
// The click forecast's 1 km temperature and rain: the point's 1 x 1 degree tile holds every step.
async function point1km(lon, lat) {
  const tile = km1.m && tileOf(km1.m, lon, lat);
  if (!tile) return;
  try {
    const pixels = async path => {
      const bmp = await load1km(path), c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
      const ctx = c.getContext('2d', {willReadFrequently: true}); ctx.drawImage(bmp, 0, 0); bmp.close();
      return ctx.getImageData(0, 0, c.width, c.height).data;
    };
    const {cells, steps} = km1.m.tiles;
    const [tr, ph] = await Promise.all([pixels(km1.m.tiles.path.replace('{lat}_{lon}', tile.key)),
      km1.phase ? pixels(km1.m.tiles.phase_path.replace('{lat}_{lon}', tile.key)).catch(() => null) : null]);
    const series = tileSeries(tr, cells, steps, tile.x, tile.y), phase = ph ? phaseSeries(ph, cells, steps, tile.x, tile.y) : null;
    if (point.lon !== lon || point.lat !== lat || !point.hours) return;            // another point was opened meanwhile
    point.hours = with1km(point.hours, km1.m.hours, series, Date.parse(km1.m.times[0]), phase); point.km1 = true; renderPoint();
  } catch { /* the 9 km rows stay */ }
}

// ---- location forecast: the bottom drawer ----
const point = {hours: null, table: null, lon: 0, lat: 0, ground: 0, km1: false, nowT: null};
const marker = new THREE.Mesh(new THREE.ConeGeometry(0.5, 2, 12).rotateX(Math.PI).translate(0, 1, 0), new THREE.MeshBasicMaterial({color: 0xffd28a}));
marker.visible = false; scene.add(marker);
let speedUnit = 'kmh';
try { if (localStorage.getItem('explorer-wind-unit') === 'kt') speedUnit = 'kt'; } catch { /* no storage: km/h */ }
const mapTime = () => data ? Date.parse(data.times[0]) + state.hour * 3600000 : null;
// The click needs no request: the rows come from the loaded grid (see pointRows in core.js), so the drawer opens at once and works offline; the 1 km values follow
// when the point's tile has arrived. Opening another point only swaps the table (the scroll position stays), nothing is rebuilt in the 3D scene.
function openPoint(p) {
  point.lon = p.lon; point.lat = p.lat; point.hours = null; point.table = null; point.km1 = false; point.nowT = null;
  marker.position.set(p.x, p.y, p.z); marker.visible = true;
  point.ground = Math.round(heightAt(p.lon, p.lat));
  $('fc').hidden = false; document.body.classList.add('has-fc');
  $('fc-title').textContent = nearestTown(p.lon, p.lat);
  $('fc-sub').textContent = `${p.lat.toFixed(3)}°N ${p.lon.toFixed(3)}°E · ${point.ground} m (1 km terrain)`;
  if (!sampler) { $('fc-body').innerHTML = '<p class="fc-empty">The forecast grid is not loaded, so there is no forecast for this point.</p>'; $('fc-badge').textContent = ''; $('fc-note').textContent = ''; return; }
  point.hours = pointRows(sampler, p.lon, p.lat);
  renderPoint(); point1km(p.lon, p.lat);
}
function nearestTown(lon, lat) {
  let best = null, bd = 1e9; for (const t of townList) { const d = Math.hypot((t.lon - lon) * Math.cos(lat * Math.PI / 180), t.lat - lat) * 111; if (d < bd) { bd = d; best = t; } }
  return best && bd < 40 ? `Near ${best.name}` : 'Point forecast';
}
function renderPoint() {
  if (!point.hours) return;
  const table = forecastTable(point.hours, {lat: point.lat, lon: point.lon, speedUnit}); point.table = table; point.nowT = null;
  const body = $('fc-body'), left = body.scrollLeft;
  body.innerHTML = renderForecast(table, {nowT: mapTime()});
  body.scrollLeft = left;
  const km = table.columns.filter(c => c.km1), a = km1.m?.assimilation, live = km.length && a?.used;
  $('fc-badge').textContent = km.length ? (live ? '1 km ML Downscaled + Live Assimilation' : '1 km ML Downscaled') : (data?.model === 'ecmwf_ifs_0p1' ? 'ECMWF IFS 9 km' : 'Forecast grid');
  $('fc-badge').title = km.length ? `Temperature and rain: LightGBM + CatBoost trained on PMD stations and ERA5-Land, applied to this ECMWF run${live ? `, nudged by ${a.stations} live stations (WeatherWalay networks and METAR) near the analysis time` : ''}.` : '';
  $('fc-unit').textContent = table.speedUnit;
  const run = data?.run ? `ECMWF run ${data.run.slice(0, 13).replace('T', ' ')} UTC` : 'the loaded forecast';
  $('fc-note').textContent = [km.length ? `Temperature and rain: 1 km ML downscaling to ${km.at(-1).hour} on ${table.days.find(d => d.key === km.at(-1).dayKey)?.label ?? ''}, then ECMWF 9 km (lighter columns).` : `Read from ${run} at 9 km.`,
    'Cloud, CAPE, snow and wind: ECMWF 9 km. Rain is the total of the 3 hours from the column time; temperature and wind are at that time. Gusts only to +90 h (ECMWF publishes none later).',
    'Icons are screening rules from rain, snow, cloud and CAPE. Screening only, not an official forecast.'].join(' ');
  updateCursor();
}
// Highlights the column that holds the time shown on the map. The DOM is touched only when the column changes (every three hours of forecast time).
function updateCursor() {
  const cols = point.table?.columns, t = mapTime(); if (!cols?.length || t === null || $('fc').hidden) return;
  let best = null; for (const c of cols) if (c.t <= t) best = c.t;
  if (best === point.nowT) return;
  point.nowT = best;
  const body = $('fc-body');
  for (const el of body.querySelectorAll('.now')) el.classList.remove('now');
  if (best !== null) for (const el of body.querySelectorAll(`[data-t="${best}"]`)) el.classList.add('now');
}
$('fc-body').addEventListener('click', e => { const el = e.target.closest('[data-t]'); if (el && data) setHour((+el.dataset.t - Date.parse(data.times[0])) / 3600000); });
function closePoint() { $('fc').hidden = true; marker.visible = false; document.body.classList.remove('has-fc'); }
$('fc-close').addEventListener('click', closePoint);
addEventListener('keydown', e => { if (e.key === 'Escape' && !$('fc').hidden) closePoint(); });
$('fc-unit').addEventListener('click', () => { speedUnit = speedUnit === 'kmh' ? 'kt' : 'kmh'; try { localStorage.setItem('explorer-wind-unit', speedUnit); } catch { /* the choice is just not remembered */ } renderPoint(); });

// click (not drag) on the terrain
{ let down = null;
  canvas.addEventListener('pointerdown', e => { down = {x: e.clientX, y: e.clientY}; });
  canvas.addEventListener('pointerup', e => { if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 5) return; const p = groundPoint(e.clientX, e.clientY); if (p) openPoint(p); }); }

// ---- controls wiring ----
function applyLayers() {
  windLines.visible = state.layers.has('w') && !gpuReady; if (gpuLines) gpuLines.visible = state.layers.has('w'); apply1kmFlags(); paintOverlay(true); saveHash(); $('temp-legend-box').hidden = !state.layers.has('t'); updateTempLegend();
  for (const [id, k] of [['l-wind', 'w'], ['l-rain', 'r'], ['l-snow', 's'], ['l-towns', 'c'], ['l-cloud', 'k'], ['l-temp', 't']]) $(id).checked = state.layers.has(k);
}
for (const [id, k] of [['l-wind', 'w'], ['l-rain', 'r'], ['l-snow', 's'], ['l-towns', 'c'], ['l-cloud', 'k'], ['l-temp', 't']]) $(id).addEventListener('change', e => { e.target.checked ? state.layers.add(k) : state.layers.delete(k); applyLayers(); });
// ---- altitude: the surface and nine pressure levels (1000 to 250 hPa) ----
const levelLoading = new Map(), altBar = $('alt-bar');
// A level's file (u, v, temperature and real height for every step) is fetched when the level is first chosen and merged into the dataset.
function loadLevel(level) {
  if (levelReady(sampler, level)) return Promise.resolve(true);
  if (!levelLoading.has(level)) levelLoading.set(level, (async () => {
    try {
      const r = await fetch('../terrain-data/' + levelFile(level));
      if (!r.ok) return false;
      const u = unpackLevelFile(await r.json(), sampler.d);
      if (!u) return false;
      mergeLevel(sampler.d, u.fields);
      for (const k of [...windTex.keys()]) if (k.startsWith(level + ':')) { windTex.get(k).dispose(); windTex.delete(k); }       // built before the level's heights were known
      windKey = '';
      return true;
    } catch { return false; } finally { levelLoading.delete(level); }
  })());
  return levelLoading.get(level);
}
function buildAltitudeBar() {
  const order = [...PRESSURE_LEVELS].reverse().map(String); order.push('sfc');                     // the highest at the top
  altBar.innerHTML = order.map(id => { const a = levelAltitude(id);
    return `<button type="button" data-level="${id}" aria-pressed="${id === state.level}" title="${a.role} (${a.m}, ${a.ft})"><b>${a.hPa === null ? 'Sfc' : a.top}</b><small>${a.hPa === null ? 'surface' : 'hPa'} · ${a.m}<br>${a.ft}</small></button>`; }).join('');
  $('w-level').innerHTML = ['sfc', ...PRESSURE_LEVELS].map(id => `<option value="${id}">${WIND_LEVELS[id].label}</option>`).join('');
}
altBar.addEventListener('click', e => { const b = e.target.closest('button'); if (b && !b.disabled) setLevel(b.dataset.level); });
// A level the forecast run has no file for is greyed out (the 850 and 700 hPa winds of the main grid still work without one).
async function markAvailableLevels() {
  try {
    const r = await fetch('../terrain-data/levels/index.json', {cache: 'no-cache'}), idx = r.ok ? await r.json() : null, have = idx && idx.run === data?.run ? Object.keys(idx.levels) : [];
    for (const b of altBar.querySelectorAll('button')) {
      const id = b.dataset.level; if (id === 'sfc') continue;
      const ok = have.includes(id) || (sampler?.has('u' + id) && sampler?.has('v' + id));
      b.disabled = !ok; if (!ok) b.title += ' · not in this forecast run';
    }
    for (const o of $('w-level').options) { const b = altBar.querySelector(`[data-level="${o.value}"]`); o.disabled = !!b?.disabled; }
  } catch { /* the buttons stay enabled; a click that finds no file says so */ }
}
function updateLevelNote(level = state.level) {
  const a = levelAltitude(level), f = windMotion(level);
  $('level-note').textContent = level === 'sfc' ? '' : `${a.top} hPa, ${a.m} (${a.ft}): ${a.role}. Where the 1 km terrain is higher than this level there is no wind and no temperature, so nothing is drawn through the mountains. The terrain adjustment applies to the surface wind only.${f < 1 ? ` Shown at ${f}× motion: the winds up here are strong, so the trails move slower than the wind (colours and speeds are not changed).` : ''}`;
}
const surfaceTempGradient = () => `linear-gradient(90deg,${TEMPERATURE_TICKS.map((t, i) => { const c = temperatureColour(t); return `rgb(${c[0]},${c[1]},${c[2]}) ${(i / (TEMPERATURE_TICKS.length - 1) * 100).toFixed(0)}%`; }).join(',')})`;
function updateTempLegend() {
  const lvl = state.level, [lo, hi] = temperatureRange(lvl);
  $('l-temp-name').textContent = lvl === 'sfc' ? 'Temperature, 2 m' : `Temperature, ${lvl} hPa`;
  if (lvl === 'sfc') { $('temp-legend').style.background = surfaceTempGradient(); $('temp-legend-scale').innerHTML = '<span>-30</span><span>-5</span><span>20</span><span>42</span><span>50 °C</span>'; return; }
  const stops = Array.from({length: 11}, (_, k) => { const c = levelTemperatureColour(lo + k / 10 * (hi - lo), lvl); return `rgb(${c[0]},${c[1]},${c[2]}) ${k * 10}%`; });
  $('temp-legend').style.background = `linear-gradient(90deg,${stops.join(',')})`;
  $('temp-legend-scale').innerHTML = temperatureTicksFor(lvl).map((t, k, a) => `<span>${t}${k === a.length - 1 ? ' °C' : ''}</span>`).join('');
}
let levelSeq = 0;
async function setLevel(level) {
  if (!WIND_LEVELS[level] || !sampler) level = 'sfc';
  const seq = ++levelSeq, btn = altBar.querySelector(`[data-level="${level}"]`);
  if (level !== 'sfc' && !levelReady(sampler, level)) {
    btn?.classList.add('loading'); $('level-note').textContent = `Loading ${level} hPa…`;
    const ok = await loadLevel(level);
    btn?.classList.remove('loading');
    if (seq !== levelSeq) return;                                                                  // another level was chosen meanwhile
    if (!ok && !(sampler.has('u' + level) && sampler.has('v' + level))) {                           // nothing to show: say so and stay where we were
      $('level-note').textContent = `The ${level} hPa data is not available for this forecast run.`; if (btn) btn.disabled = true; return;
    }
  }
  $('w-level').value = level;
  for (const b of altBar.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.level === level));
  updateLevelNote(level);
  finishLevelChange();                                                                             // a change still running is completed first
  if (gpuReady && level !== state.level) Object.assign(trans, {active: true, committed: false, t: 0, from: state.level, to: level, fromKm: WIND_LEVELS[state.level].heightKm});
  else commitLevel(level);                                                                         // otherwise at once (no GPU trails to fade)
}
// The level takes effect: the simulation, the legends and the layers follow it. Half way through a level change, or at once.
function commitLevel(level) {
  state.level = level; trans.committed = true; $('w-level').value = level;
  updateLevelNote(); updateTempLegend(); updateWindLegend();
  if (gpuReady) { resetNext = true; windKey = ''; } else for (let i = 0; i < MAXP; i++) respawn(i);
  apply1kmFlags(); paintOverlay(true); saveHash();
}
$('w-level').addEventListener('change', e => setLevel(e.target.value));
$('w-density').value = state.density; $('o-density').textContent = state.density;
$('w-trail').value = state.trailSegs; $('o-trail').textContent = trailLabel(state.trailSegs);
$('w-density').addEventListener('input', e => { state.density = +e.target.value; $('o-density').textContent = e.target.value; });
$('w-follow').addEventListener('change', e => { state.follow = e.target.checked; });
$('w-width').value = state.widthScale; $('o-width').textContent = state.widthScale.toFixed(1) + '×';
$('w-width').addEventListener('input', e => { state.widthScale = clampWidthControl(+e.target.value); $('o-width').textContent = state.widthScale.toFixed(1) + '×'; });
$('l-border').addEventListener('change', e => { state.border = e.target.checked; });
$('w-speed').addEventListener('input', e => { state.speed = speedFromStep(+e.target.value); $('o-speed').textContent = state.speed + '×'; });
$('w-trail').addEventListener('input', e => { state.trailSegs = +e.target.value; $('o-trail').textContent = trailLabel(state.trailSegs); });
$('t-exag').addEventListener('input', e => { setExag(+e.target.value); });
function setExag(v) { if (v !== state.exag) scheduleNormals(); state.exag = v; $('t-exag').value = v; $('o-exag').textContent = v.toFixed(1) + '×'; if (terrain) terrain.scale.y = v; for (const L of lods.values()) L.mesh.scale.y = v; if (!gpuReady) for (let i = 0; i < MAXP; i++) for (let k = 0; k < TRAIL; k++) { const b = (i * TRAIL + k) * 3; hist[b + 1] = sceneHeightAt(hist[b], hist[b + 2]) + LIFT; } saveHash(); }
function setLight() { sun.intensity = state.imagery && baseSat ? 1.5 : PLAIN_LIGHT.sun; hemi.intensity = state.imagery && baseSat ? 1.9 : PLAIN_LIGHT.hemi; }
$('t-sat').addEventListener('change', e => { state.imagery = e.target.checked && !!baseSat; if (e.target.checked && !baseSat) e.target.checked = false; setLight(); paintOverlay(true); if (state.imagery) for (const L of lods.values()) ensureLevelImagery(L); });
$('t-detail').addEventListener('change', e => { state.detail = e.target.checked; buildTerrain(); });
$('t-top').addEventListener('change', e => { const v = readView(); flyTo({...v, tilt: e.target.checked ? 0.5 : 50, heading: 0}); });
controls.addEventListener('end', saveHash);
controls.addEventListener('change', () => { moveStamp = performance.now(); });
controls.addEventListener('change', () => { $('t-top').checked = controls.getPolarAngle() < 0.05; });
$('t-back').addEventListener('click', () => { state.playing = false; syncPlay(); setHour(Math.round(state.hour) - 1); });
$('t-fwd').addEventListener('click', () => { state.playing = false; syncPlay(); setHour(Math.round(state.hour) + 1); });
$('t-slider').addEventListener('input', e => { state.playing = false; syncPlay(); setHour(+e.target.value); });
$('t-now').addEventListener('click', () => { const h = nowHour(); if (h === null) { $('t-sub').textContent = 'The forecast data does not cover now: it is out of date'; return; } state.playing = false; syncPlay(); setHour(Math.round(h)); });
$('t-play').addEventListener('click', () => { state.playing = !state.playing; syncPlay(); });
function syncPlay() { $('t-play').textContent = state.playing ? 'Pause' : 'Play'; $('t-play').setAttribute('aria-pressed', String(state.playing)); }
$('toggle-panel').addEventListener('click', e => { const o = $('panel').classList.toggle('open'); e.currentTarget.setAttribute('aria-expanded', String(o)); });
$('presets').innerHTML = '<option value="">Regional views…</option>' + PRESETS.map((p, i) => `<option value="${i}">${p.name}</option>`).join('');
$('presets').addEventListener('change', e => { if (e.target.value !== '') flyTo(PRESETS[+e.target.value]); e.target.value = ''; });
$('share').addEventListener('click', async e => {
  saveHash(); await new Promise(r => setTimeout(r, 300)); const b = e.currentTarget;
  try { await navigator.clipboard.writeText(location.href); b.textContent = 'Link copied'; } catch { b.textContent = 'Copy from the address bar'; }
  setTimeout(() => { b.textContent = 'Copy view link'; }, 2200);
});
// legends
$('temp-legend').style.background = `linear-gradient(90deg,${TEMPERATURE_TICKS.map((t, i) => { const c = temperatureColour(t); return `rgb(${c[0]},${c[1]},${c[2]}) ${(i / (TEMPERATURE_TICKS.length - 1) * 100).toFixed(0)}%`; }).join(',')})`;
// Streaks are white (STREAK.white = 1): the speed shows as the length of the streak, so there is no colour scale. With STREAK.white below 1 the colour scale returns.
const windGradient = `linear-gradient(90deg,${WIND.map(([t]) => { const c = windColour(t); return `rgb(${c[0]},${c[1]},${c[2]}) ${(t * 100).toFixed(1)}%`; }).join(',')})`;
$('wind-legend').style.background = windGradient;
// The scale follows the level: 0, 1/4, 1/2, 3/4 and the top of the level's range (windRange), in m/s with km/h below.
function updateWindLegend() {
  const range = windRange(state.level, state.sfcRange), tinted = STREAK.white < 1;
  $('wind-legend').hidden = !tinted; $('wind-ticks').hidden = !tinted;
  $('wind-ticks').innerHTML = windTicks(range).map(({f, ms, kmh}) => `<span style="left:${f * 100}%">${ms}${f === 0 ? ' m/s' : ''}<br>${kmh}${f === 0 ? ' km/h' : ''}</span>`).join('');
  $('wind-legend').title = `Trail colour by wind speed: the top colour is ${range} m/s (${Math.round(range * 3.6)} km/h) at this level`;
  $('wind-length-note').textContent = tinted ? '' : `Streak length shows the speed: short in light wind, longest from ${range} m/s (${Math.round(range * 3.6)} km/h) at this level.`;
}
updateWindLegend();
$('legend').style.background = `linear-gradient(90deg,${[0.1, 0.5, 2, 5, 10, 25, 50].map(v => { const c = rainColour(v); return `rgb(${c[0]},${c[1]},${c[2]})`; }).join(',')})`;

// ---- navigation buttons, keys, double-click ----
const zoomBy = f => { const v = readView(); flyTo({...v, dist: Math.min(5000, Math.max(3, v.dist * f))}); };
const turnBy = deg => { const v = readView(); flyTo({...v, heading: v.heading + deg}); };
$('z-in').addEventListener('click', () => zoomBy(0.5));
$('z-out').addEventListener('click', () => zoomBy(2));
$('tilt-up').addEventListener('click', () => { const v = readView(); flyTo({...v, tilt: Math.min(85, v.tilt + 12)}); });
$('tilt-down').addEventListener('click', () => { const v = readView(); flyTo({...v, tilt: Math.max(0.5, v.tilt - 12)}); });
$('compass').addEventListener('click', () => { const v = readView(); flyTo({...v, heading: 0}); });
$('home').addEventListener('click', () => flyTo(PRESETS[0]));
addEventListener('keydown', e => {
  if (e.target.closest?.('input,select,textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  const k = e.key.toLowerCase(), acts = {'+': () => zoomBy(0.7), '=': () => zoomBy(0.7), '-': () => zoomBy(1.4), '_': () => zoomBy(1.4), q: () => turnBy(-15), e: () => turnBy(15), n: () => $('compass').click(), h: () => $('home').click(), r: () => $('mode').click(), ' ': () => $('t-play').click()};
  if (e.key === 'PageUp' || e.key === 'PageDown') { e.preventDefault(); const v = readView(); flyTo({...v, tilt: Math.min(85, Math.max(0.5, v.tilt + (e.key === 'PageUp' ? -12 : 12)))}); return; }
  if (acts[k]) { e.preventDefault(); acts[k](); }
});
canvas.addEventListener('dblclick', e => { const p = groundPoint(e.clientX, e.clientY); if (!p) return; const v = readView(); flyTo({...v, lon: p.lon, lat: p.lat, dist: Math.max(3, v.dist * 0.45)}); });
// Left-button mode: move the map, or rotate and tilt it (for mice where right-drag is awkward). Sliders mirror and set the same view.
let rotateMode = false;
function setMode(on) {
  rotateMode = on; controls.mouseButtons.LEFT = on ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN; controls.touches.ONE = on ? THREE.TOUCH.ROTATE : THREE.TOUCH.PAN;
  const b = $('mode'); b.textContent = on ? '⟳' : '✥'; b.setAttribute('aria-pressed', String(on)); b.setAttribute('aria-label', on ? 'Left mouse button: rotate and tilt' : 'Left mouse button: move the map'); b.title = (on ? 'Dragging rotates and tilts' : 'Dragging moves the map') + ' (R)';
  canvas.style.cursor = on ? 'grab' : '';
}
$('mode').addEventListener('click', () => setMode(!rotateMode));
function setTilt(deg) { const v = readView(); setView({...v, tilt: Math.min(85, Math.max(0.5, deg))}); saveHash(); }
$('t-tilt').addEventListener('input', e => setTilt(+e.target.value));
$('t-head').addEventListener('input', e => { const v = readView(); setView({...v, heading: +e.target.value}); saveHash(); });
function syncViewSliders() {
  const v = readView(), t = $('t-tilt'), h = $('t-head');
  if (document.activeElement !== t) { t.value = Math.round(v.tilt); } $('o-tilt').textContent = Math.round(v.tilt) + '°';
  if (document.activeElement !== h) { h.value = Math.round(v.heading); } $('o-head').textContent = Math.round(v.heading) + '°';
}
controls.addEventListener('change', syncViewSliders);
// ---- search ----
{ const input = $('search'), list = $('results'); let timer = 0, seq = 0;
  // Typed coordinates ("35.3254, 75.5322"): fly there and open the forecast drawer for that point, the same as a click on the map.
  const goTo = (lat, lon) => {
    if (!inForecastArea(lat, lon)) { list.innerHTML = '<li class="results-note">Outside the forecast area (60 to 78 E, 23 to 38 N)</li>'; list.hidden = false; return false; }
    const [x, z] = toScene(lon, lat); flyTo({lon, lat, dist: 40, tilt: 55, heading: 0});
    openPoint({lon, lat, x, y: sceneHeightAt(x, z), z});
    for (const ms of [800, 2500, 6000]) setTimeout(() => { if (point.lon === lon && point.lat === lat) marker.position.y = sceneHeightAt(x, z); }, ms);   // finer terrain arrives while the camera flies
    list.hidden = true; input.value = `${lat.toFixed(4)}, ${lon.toFixed(4)}`; return true;
  };
  const show = items => { list.innerHTML = ''; items.forEach(it => { const li = document.createElement('li'), b = document.createElement('button'); b.type = 'button'; b.textContent = it.label; b.addEventListener('click', () => { if (it.coords) { goTo(it.lat, it.lon); return; } flyTo({lon: it.lon, lat: it.lat, dist: 90, tilt: 55, heading: 0}); list.hidden = true; input.value = it.label.split(',')[0]; }); li.appendChild(b); list.appendChild(li); }); list.hidden = !items.length; };
  input.addEventListener('input', () => {
    clearTimeout(timer); const q = input.value.trim().toLowerCase(); if (q.length < 2) { list.hidden = true; return; }
    const c = parseLatLon(input.value); if (c) { seq++; show([{label: `${c.lat.toFixed(4)}°N ${c.lon.toFixed(4)}°E · open the forecast here`, lat: c.lat, lon: c.lon, coords: true}]); return; }
    const local = townList.filter(t => t.name.toLowerCase().startsWith(q)).slice(0, 5).map(t => ({label: t.name, lon: t.lon, lat: t.lat}));
    show(local);
    const mine = ++seq;
    timer = setTimeout(async () => { try {
      const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?' + new URLSearchParams({name: q, count: '8', countryCode: 'PK'}), {signal: AbortSignal.timeout(8000)});
      const found = ((await r.json()).results || []).map(x => ({label: [x.name, x.admin1].filter(Boolean).join(', '), lon: x.longitude, lat: x.latitude}));
      if (mine === seq) show([...local, ...found.filter(f => !local.some(l => l.label === f.label))].slice(0, 9));
    } catch { /* local matches stay */ } }, 300);
  });
  input.addEventListener('keydown', e => { if (e.key !== 'Enter') return; const c = parseLatLon(input.value); if (c) { e.preventDefault(); goTo(c.lat, c.lon); } else { const b = list.querySelector('button'); if (b) b.click(); } });
  document.addEventListener('click', e => { if (!e.target.closest('.search')) list.hidden = true; }); }

// ---- loop ----
function resize() { const w = canvas.clientWidth, h = canvas.clientHeight; if (canvas.width !== Math.floor(w * renderer.getPixelRatio()) || canvas.height !== Math.floor(h * renderer.getPixelRatio())) { renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); } }
addEventListener('message', e => { if (e.origin === location.origin && e.data?.type === 'badal-studio-visibility') state.visible = !!e.data.visible; });
document.addEventListener('visibilitychange', () => { if (document.hidden) { state.playing = false; syncPlay(); } });
let last = performance.now();
// ?fps in the address: frames per second and the slowest frame of each second, top left (for checking the GPU path on a real machine)
const fpsBox = new URLSearchParams(location.search).has('fps') ? Object.assign(document.body.appendChild(document.createElement('div')),
  {style: 'position:absolute;z-index:20;left:14px;top:4px;font:11px monospace;color:#8fd0ff;text-shadow:0 1px 3px #000;pointer-events:none'}) : null;
const fpsStat = {t0: performance.now(), n: 0, worst: 0, prev: performance.now()};
function countFrame(now) {
  fpsStat.worst = Math.max(fpsStat.worst, now - fpsStat.prev); fpsStat.prev = now; fpsStat.n++;
  if (now - fpsStat.t0 >= 1000) {
    fpsBox.textContent = `${Math.round(fpsStat.n * 1000 / (now - fpsStat.t0))} FPS · slowest frame ${fpsStat.worst.toFixed(1)} ms · ${gpuReady ? 'GPU' : 'CPU'} wind, ${Math.floor(state.density * QUALITY_STEPS[quality.level].trails)} trails · quality ${quality.level} (pixel ratio ${renderer.getPixelRatio().toFixed(2)})${km1.ready ? ' · 1 km on' : ''}`;
    fpsStat.t0 = now; fpsStat.n = 0; fpsStat.worst = 0;
  }
}
function frame(now) {
  requestAnimationFrame(frame);
  if (!state.visible || document.hidden || !terrain) { last = now; return; }
  adaptQuality(now, now - last);
  const dt = Math.min(0.05, (now - last) / 1000); last = now;
  stepFly(now);
  if (state.playing && data) { let h = state.hour + dt; if (h > sampler.lastHour) h = 0; state.hour = h; updateTimeLabel(); updateCursor(); }
  controls.update(); keepInside(); resize(); checkPatch(now); update1km();
  if (state.layers.has('r') || state.layers.has('s')) paintOverlay();
  if (state.layers.has('w')) { if (gpuReady) stepWindGpu(dt); else stepWind(dt); }
  updateBoundary();
  updateClouds(dt);
  marker.scale.setScalar(Math.max(0.4, camera.position.distanceTo(controls.target) * 0.012));
  $('compass-needle').style.transform = 'rotate(' + (-controls.getAzimuthalAngle() * 180 / Math.PI) + 'deg)';
  placeLabels(); placePins();
  const tr = performance.now(); renderer.render(scene, camera); const rd = performance.now() - tr;
  if (rd > 40) { const L = (window.__slowRenders ||= []); L.push([Math.round(tr), Math.round(rd)]); if (L.length > 30) L.shift(); }       // renders over 40 ms: a new level's buffers and textures reaching the GPU
  if (fpsBox) countFrame(now);
}

// ---- start ----
(async () => {
  try {
    for (const file of ['grid-hires.json', 'grid.json']) {              // 0.1 degree (9 km) first, the 0.5 degree sample as the fallback
      try {
        const r = await fetch('../terrain-data/' + file, {cache: 'no-cache'});
        if (!r.ok) continue;
        const d = await r.json();
        if (validDataset(d)) { data = unpackDataset(d); sampler = new GridSampler(data); break; }
      } catch { /* try the next file */ }
    }
  } catch { /* terrain still works without a forecast grid */ }
  const dem = await loadTiles(TILE_URL, Z, TX0, TX1, TY0, TY1, 'terrain'), decoded = decodeDem(dem.canvas);
  heights = decoded.hts; baseCanvas.getContext('2d').drawImage(decoded.col, 0, 0);
  baseFlow = {...flowGrid(heights, W, H, 2, 1, 5, (MX1 - MX0) / W * 2 * SCALE * 1000), mx0: MX0, mx1: MX1, my0: MY0, my1: MY1};
  makeBaseTextures(); initGpuWind(); initBoundary();
  const sat = await loadTiles(IMG_URL, Z, TX0, TX1, TY0, TY1, 'satellite imagery');
  const loaded = {failed: dem.failed}; if (sat.failed > 12) { state.imagery = false; $('t-sat').checked = false; } else baseSat = sat.canvas;
  buildTerrain(); loadLabels();
  const v = decodeView(location.hash);
  if (v) { state.layers = new Set(v.layers); state.pendingLevel = v.level; setExag(v.exag); state.hour = Math.min(v.hour, sampler?.lastHour ?? v.hour); setView(v); } else setView(PRESETS[0]);
  const n = nowHour(); if ((!v || reloadedForNewData) && n !== null) state.hour = Math.round(n);        // a reload for newer data keeps the view but goes to the current hour
  if (data) $('t-slider').max = sampler.lastHour;
  if (data?.model === 'ecmwf_ifs_0p1') $('credit-forecast').textContent = `Forecast: ECMWF Open Data (CC BY 4.0), IFS 0.1° (9 km), run ${data.run.slice(0, 13).replace('T', ' ')} UTC, 3-hourly, interpolated in time`;
  buildAltitudeBar(); await markAvailableLevels();                                              // the level files are loaded when a level is chosen
  if (!sampler?.has('t2m')) { $('l-temp').disabled = true; $('l-temp').title = 'This forecast grid has no temperature'; state.layers.delete('t'); }
  setLevel(state.pendingLevel || 'sfc');
  await init1km();
  applyLayers(); updateTimeLabel(); setDetailNote(); setLight();
  const notes = [];
  if (!data) notes.push('The forecast grid could not be loaded: terrain only.');
  else if (nowHour() === null) notes.push('The forecast grid is out of date and does not cover now.');
  if (loaded.failed) notes.push(`${loaded.failed} terrain tile(s) failed to load and show as sea level.`);
  if (notes.length) { $('status').textContent = notes.join(' '); setTimeout(() => { $('status').hidden = true; }, 7000); } else $('status').hidden = true;
  requestAnimationFrame(frame);
  watchNewData();
})();
