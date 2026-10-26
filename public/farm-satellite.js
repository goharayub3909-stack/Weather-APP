import { FIELD_LIBRARY_KEY, readFieldLibrary, sameFieldLocation, boundaryGeoJSON, fieldChangeSummary } from "./field-workspace.js";
import { addTileHelp } from "./tile-help.js";
import {
  vegetationSamples,
  finite,
  thermalMoistureIndex,
  validField,
  fieldSamplePoints,
  rasterValue,
  validPixel,
  qualityAsset,
  recentSceneDays,
  historyNarrative,
  renderFieldChart,
} from "./farm-monitoring.js";
import { currentValue, distanceKm } from "./current-weather.js";
import { darkMap, pkt } from "./map-utils.js";
import { fieldAreaHa } from "./agri-models.js";
import { FIELD_INDICES, ZONE_COLORS, fieldColormap, indexRecipe, zoneExpression, indexMeaning, indexColors } from "./farm-indices.js";
// How far back scenes and the field report go.
export const HISTORY_DAYS = 365;
// A pass counts toward the field mean only when at least this share of the field is clear.
export const MIN_CLEAR_FRACTION = 0.6;

// Pixel-quality expressions for the statistics service. Bitwise & is not allowed in
// server expressions, so "low N bits are zero" is written as value % 2^N == 0.
export const QA_CONDITION = {
  sentinel: "((SCL_b1==4)|(SCL_b1==5)|(SCL_b1==6))", // vegetation, not vegetated, water
  landsat: "((qa_pixel_b1 % 64)==0)", // fill, dilated cloud, cirrus, cloud, shadow, snow all clear
  "modis-lst": "((QC_Day_b1 % 256)==0)",
};

/**
 * Expression that returns two bands for one statistics request:
 * band 1 = index where the pixel is clear, else 0; band 2 = 1 where clear, else 0.
 * Field mean = mean(band 1) / mean(band 2); clear fraction = mean(band 2).
 */
export function maskedStatsExpression(sensor, indexExpression) {
  const cond = QA_CONDITION[sensor];
  if (!cond || !indexExpression) return null;
  return `where(${cond},${indexExpression},0);where(${cond},1,0)`;
}

/**
 * Thin a year of passes to the least-cloudy pass in each window (Sentinel-2 revisits
 * about every 5 days), keeping requests modest. Input/output: [date, scene] pairs.
 */
export function thinPasses(days, windowDays = 5) {
  const best = new Map();
  for (const entry of days) {
    const scene = entry[1],
      time = Date.parse(scene.properties.datetime || scene.properties.start_datetime);
    if (!finite(time)) continue;
    const bin = Math.floor(time / (windowDays * 86400000)),
      cloud = scene.properties["eo:cloud_cover"] ?? 100,
      current = best.get(bin);
    if (!current || cloud < (current[1].properties["eo:cloud_cover"] ?? 100)) best.set(bin, entry);
  }
  return [...best.values()];
}

/** Turn a statistics response for maskedStatsExpression into a field reading. */
export function maskedFieldMean(statistics, minClear = MIN_CLEAR_FRACTION) {
  const bands = Object.values(statistics || {});
  if (bands.length < 2) return { value: null, clear: 0, pixels: 0 };
  const sum = bands[0]?.mean, clear = bands[1]?.mean, pixels = bands[1]?.count ?? 0;
  if (!finite(sum) || !finite(clear) || clear <= 0 || !pixels) return { value: null, clear: finite(clear) ? clear : 0, pixels };
  return { value: clear >= minClear ? sum / clear : null, clear, pixels };
}

// A scene is a finite satellite footprint, not a global basemap. Restrict tile
// requests to its bounds and keep edge/no-data errors separate from total failure.
export function initFarmSatellite() {
  const $ = (id) => document.getElementById(id),
    base = "https://planetarycomputer.microsoft.com";
  const collections = {
    sentinel: { id: "sentinel-2-l2a", resolution: "10 m", assets: ["visual"], red: "B04", nir: "B08" },
    landsat: { id: "landsat-c2-l2", resolution: "30 m", assets: ["red", "green", "blue"], red: "red", nir: "nir08" },
    "modis-lst": { id: "modis-11A1-061", resolution: "1 km · daily", assets: ["LST_Day_1km"] },
    modis: { id: "modis-13Q1-061", resolution: "250 m · 16-day composite", assets: ["250m_16_days_NDVI"] },
  };
  let map,
    place = ["Islamabad", 33.69, 73.05],
    controller,
    scenes = [],
    layer,
    contextLayer,
    outline,
    sceneBounds,
    polygon,
    vertices = [],
    drawing = false,
    marker,
    drawVersion = 0,
    editing = false,
    pointMode = false,
    handles = [],
    selectedPoint = -1,
    undo = [],
    redo = [],
    probe = null,
    probeMarker,
    probeVersion = 0,
    historyController,
    historyVersion = 0,
    farmContext = null,
    historyRows = [];
  const sampleCache = new Map(),
    calibration = () => ({
      wet: $("agri-smi-wet").value.trim() === "" ? null : Number($("agri-smi-wet").value),
      dry: $("agri-smi-dry").value.trim() === "" ? null : Number($("agri-smi-dry").value),
    });
  const status = (text) => ($("agri-satellite-status").textContent = text);
  let library = [];
  try {
    library = readFieldLibrary(localStorage.getItem(FIELD_LIBRARY_KEY));
  } catch {}
  function refreshLibrary(selected = "") {
    const menu = $("farm-boundary-library");
    menu.replaceChildren(new Option("New / unsaved boundary", ""));
    for (const record of library.filter((r) => sameFieldLocation(r, place.slice(1)))) menu.append(new Option(record.name, record.id));
    menu.value = selected;
    $("farm-boundary-delete").disabled = !menu.value;
  }
  function saveLibrary(next) {
    try {
      localStorage.setItem(FIELD_LIBRARY_KEY, JSON.stringify(next));
      library = next;
      return true;
    } catch {
      $("farm-boundary-status").textContent = "Browser storage is unavailable or full. Export GeoJSON to keep this boundary.";
      return false;
    }
  }
  $("farm-boundary-save").addEventListener("click", () => {
    if (!validField(vertices) || drawing) return;
    const name = $("farm-boundary-name").value.trim();
    if (!name) {
      $("farm-boundary-status").textContent = "Give this boundary a name first.";
      $("farm-boundary-name").focus();
      return;
    }
    const selected = $("farm-boundary-library").value,
      id = selected || crypto.randomUUID(),
      record = { id, name, location: place.slice(1), vertices: vertices.map((p) => [...p]) };
    if (!selected && library.length >= 50) {
      $("farm-boundary-status").textContent = "The browser library holds up to 50 boundaries. Export or remove an old boundary first.";
      return;
    }
    if (saveLibrary([...library.filter((r) => r.id !== id), record])) {
      refreshLibrary(id);
      $("farm-boundary-status").textContent = "Saved " + name + " in this browser. Crop and actual stage remain separate selections.";
    }
  });
  $("farm-boundary-library").addEventListener("change", () => {
    const record = library.find((r) => r.id === $("farm-boundary-library").value && sameFieldLocation(r, place.slice(1)));
    $("farm-boundary-delete").disabled = !record;
    if (!record) {
      $("farm-boundary-name").value = "";
      $("farm-boundary-status").textContent = "Draw a new boundary or rename and save a copy of the current outline.";
      return;
    }
    ensureMap();
    snapshot();
    probe = null;
    probeVersion++;
    if (probeMarker) map.removeLayer(probeMarker);
    probeMarker = null;
    $("agri-point-panel").hidden = true;
    $("agri-smi-wet").value = $("agri-smi-dry").value = "";
    vertices = record.vertices.map((p) => [...p]);
    drawing = editing = false;
    pointMode = true;
    $("agri-field-draw").textContent = "Draw field boundary";
    $("farm-boundary-name").value = record.name;
    syncModeButtons();
    clearHistory();
    syncBoundary(false);
    map.fitBounds(L.latLngBounds(vertices), { padding: [35, 35], maxZoom: 17 });
    load();
    $("farm-boundary-status").textContent = "Loaded " + record.name + ". Weather location, crop and confirmed stage were not changed.";
  });
  $("farm-boundary-delete").addEventListener("click", () => {
    const id = $("farm-boundary-library").value;
    if (!id) return;
    if (saveLibrary(library.filter((r) => r.id !== id))) {
      refreshLibrary();
      $("farm-boundary-status").textContent = "Saved copy removed. The outline stays on the map; save it again or export it if needed.";
    }
  });
  $("farm-boundary-export").addEventListener("click", () => {
    if (!validField(vertices)) return;
    const name = $("farm-boundary-name").value.trim() || "My field",
      blob = new Blob([JSON.stringify(boundaryGeoJSON(vertices, name), null, 2)], { type: "application/geo+json" }),
      url = URL.createObjectURL(blob),
      a = document.createElement("a");
    a.href = url;
    a.download = (name.replace(/[^a-z0-9_-]/gi, "-").slice(0, 60) || "field") + ".geojson";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
  refreshLibrary();

  function clearImagery() {
    drawVersion++;
    probeVersion++;
    if (layer) map?.removeLayer(layer);
    if (outline) map?.removeLayer(outline);
    if (contextLayer) map?.removeLayer(contextLayer);
    layer = contextLayer = outline = null;
    sceneBounds = null;
    $("agri-index-legend").hidden = true;
    $("agri-satellite-retry").hidden = true;
    $("agri-satellite-zoom").disabled = true;
  }
  function fieldNote() {
    $("farm-boundary-save").disabled = !validField(vertices) || drawing;
    $("farm-boundary-export").disabled = !validField(vertices) || drawing;
    const area = validField(vertices) ? fieldAreaHa(vertices) : null;
    $("agri-field-undo").disabled = !undo.length;
    $("agri-field-redo").disabled = !redo.length;
    $("agri-field-remove-last").disabled = !vertices.length;
    $("agri-field-history-panel").hidden = false;
    $("agri-field-history-load").disabled = !validField(vertices);
    $("agri-field-fit").disabled = !validField(vertices);
    $("agri-field-delete-point").disabled = selectedPoint < 0;
    $("agri-field-edit").disabled = vertices.length < 3;
    $("agri-field-area").hidden = !vertices.length;
    $("agri-field-area").textContent = !finite(area)
      ? "No valid field boundary. Use at least three distinct points without crossing edges."
      : area.toLocaleString("en-GB", { maximumFractionDigits: 2 }) + " ha · drawn boundary, not a surveyed area";
    $("agri-field-coverage").textContent = sceneBounds
      ? vertices.some((p) => !sceneBounds.contains(p))
        ? "The boundary extends beyond this scene’s coverage. The dashed rectangle marks the selected scene. Load scenes for the boundary and choose another scene, or zoom to the scene to inspect its imagery."
        : "Dashed rectangle: selected scene bounds. A single scene may not cover the entire boundary; cloud / no-data pixels are not crop-health measurements."
      : vertices.length >= 3
        ? "Finish the boundary, then load scenes that intersect it. A scene is not a country-wide image."
        : "";
  }
  function snapshot() {
    historyController?.abort();
    historyVersion++;
    redo = [];
    undo.push(vertices.map((p) => [...p]));
    if (undo.length > 40) undo.shift();
  }
  function syncBoundary(redraw = true) {
    if (polygon) map.removeLayer(polygon);
    polygon = vertices.length
      ? L.polygon(vertices, { color: validField(vertices) ? "#bbef72" : "#ed8c75", weight: 2, fillOpacity: 0.03 }).addTo(map)
      : null;
    handles.forEach((h) => map.removeLayer(h));
    handles = [];
    selectedPoint = -1;
    if (editing)
      vertices.forEach((point, i) => {
        const handle = L.marker(point, {
          draggable: true,
          bubblingMouseEvents: false,
          icon: L.divIcon({ className: "field-vertex", html: String(i + 1), iconSize: [26, 26], iconAnchor: [13, 13] }),
        }).addTo(map);
        handle.on("dragstart", snapshot);
        handle.on("dragend", () => {
          const p = handle.getLatLng();
          vertices[i] = [p.lat, p.lng];
          syncBoundary();
        });
        handle.on("click", () => {
          selectedPoint = i;
          handles.forEach((h) => h.getElement()?.classList.remove("selected"));
          handle.getElement()?.classList.add("selected");
          $("agri-field-delete-point").disabled = false;
        });
        handle.on("contextmenu", () => {
          selectedPoint = i;
          removePoint();
        });
        handles.push(handle);
        const next = vertices[(i + 1) % vertices.length],
          middle = L.marker([(point[0] + next[0]) / 2, (point[1] + next[1]) / 2], {
            bubblingMouseEvents: false,
            icon: L.divIcon({ className: "field-midpoint", html: "+", iconSize: [20, 20], iconAnchor: [10, 10] }),
          }).addTo(map);
        middle.on("click", () => {
          snapshot();
          vertices.splice(i + 1, 0, [(point[0] + next[0]) / 2, (point[1] + next[1]) / 2]);
          syncBoundary();
        });
        handles.push(middle);
      });
    fieldNote();
    if (redraw && !drawing) {
      historyController?.abort();
      historyVersion++;
      if (scenes.length) draw();
      else if (validField(vertices)) load();
      if (validField(vertices)) loadHistory();
      else clearHistory();
    }
  }
  function removeLast() {
    if (!vertices.length) return;
    snapshot();
    vertices.pop();
    syncBoundary(!drawing);
  }
  function removePoint() {
    if (selectedPoint < 0) return;
    snapshot();
    vertices.splice(selectedPoint, 1);
    syncBoundary();
  }
  function ensureMap() {
    if (map) return;
    map = darkMap("agri-satellite-map");
    map.setMaxZoom(20);
    queueMicrotask(applyBasemap);
    map.getContainer().addEventListener("keydown", (e) => {
      if (e.target !== map.getContainer()) return;
      if (drawing && ["Backspace", "Delete"].includes(e.key)) {
        e.preventDefault();
        removeLast();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
        e.preventDefault();
        $(e.shiftKey ? "agri-field-redo" : "agri-field-undo").click();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "y") {
        e.preventDefault();
        $("agri-field-redo").click();
      }
    });
    map.createPane("farm-imagery");
    map.getPane("farm-imagery").style.zIndex = 300;
    map.on("click", (e) => {
      if (drawing) {
        snapshot();
        vertices.push([e.latlng.lat, e.latlng.lng]);
        syncBoundary(false);
      } else if (pointMode) {
        probe = [e.latlng.lat, e.latlng.lng];
        if (probeMarker) map.removeLayer(probeMarker);
        probeMarker = L.marker(probe, {
          draggable: true,
          autoPan: true,
          icon: L.divIcon({ className: "field-probe", html: "⌖", iconSize: [30, 30], iconAnchor: [15, 15] }),
        }).addTo(map);
        probeMarker.on("dragend", () => {
          const p = probeMarker.getLatLng();
          probe = [p.lat, p.lng];
          inspectPoint();
        });
        inspectPoint();
      }
    });
    syncModeButtons();
  }
  function recipeFor(sensor, mode, scene) {
    return indexRecipe(sensor, mode, scene, calibration());
  }
  function historyMode() {
    const selected = $("agri-history-mode").value,
      display = $("agri-satellite-mode").value;
    return selected === "follow" ? (display === "rgb" ? "ndvi" : display) : selected;
  }
  function syncModes() {
    const sensor = $("agri-satellite-source").value;
    for (const option of $("agri-satellite-mode").options)
      option.disabled =
        sensor === "modis-lst"
          ? !["lst", "smi"].includes(option.value)
          : sensor === "modis"
            ? option.value !== "ndvi"
            : sensor === "landsat"
              ? option.value === "ndre"
              : ["lst", "smi"].includes(option.value);
    if ($("agri-satellite-mode").selectedOptions[0].disabled) $("agri-satellite-mode").value = sensor === "modis-lst" ? "lst" : "ndvi";
    $("agri-smi-calibration").hidden = $("agri-satellite-mode").value !== "smi" && $("agri-history-mode").value !== "smi";
    if ($("agri-satellite-mode").value === "smi" || $("agri-history-mode").value === "smi")
      document.querySelector(".satellite-display-settings").open = true;
    for (const option of $("agri-history-mode").options) {
      const mapOption = [...$("agri-satellite-mode").options].find((o) => o.value === option.value);
      option.disabled = option.value !== "follow" && (!mapOption || mapOption.disabled);
    }
    if ($("agri-history-mode").selectedOptions[0].disabled) $("agri-history-mode").value = "follow";
  }
  async function load() {
    ensureMap();
    syncModes();
    controller?.abort();
    controller = new AbortController();
    const signal = controller.signal;
    clearImagery();
    scenes = [];
    $("agri-scene").replaceChildren();
    const source = collections[$("agri-satellite-source").value];
    status("Finding public scenes for " + (vertices.length >= 3 ? "the drawn boundary" : "this location") + "…");
    try {
      const geometry = validField(vertices)
        ? { type: "Polygon", coordinates: [[...vertices, vertices[0]].map(([lat, lon]) => [lon, lat])] }
        : { type: "Point", coordinates: [place[2], place[1]] };
      const u = new URL(base + "/api/stac/v1/search");
      u.search = new URLSearchParams({
        collections: source.id,
        intersects: JSON.stringify(geometry),
        datetime: new Date(Date.now() - HISTORY_DAYS * 86400000).toISOString() + "/" + new Date().toISOString(),
        limit: "1000",
        sortby: "-datetime",
      });
      const r = await fetch(u, { signal, cache: "no-store" });
      if (!r.ok) throw Error("Scene service returned " + r.status);
      const data = await r.json();
      let next = data.links?.find((l) => l.rel === "next");
      for (let page = 0; next && page < 5; page++) {
        const target = new URL(next.href);
        if (target.origin !== base) break;
        const response = await fetch(target, {
          signal,
          method: next.method || "GET",
          ...(next.method === "POST" ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(next.body) } : {}),
        });
        if (!response.ok) break;
        const more = await response.json();
        data.features.push(...(more.features || []));
        next = more.links?.find((l) => l.rel === "next");
      }
      if (signal.aborted) return;
      scenes = (data.features || [])
        .filter((f) => (f.properties["eo:cloud_cover"] ?? 0) <= 60)
        .sort((a, b) =>
          String(b.properties.datetime || b.properties.start_datetime).localeCompare(
            String(a.properties.datetime || a.properties.start_datetime),
          ),
        );
      for (const [i, f] of scenes.entries())
        $("agri-scene").append(
          new Option(
            pkt(f.properties.datetime || f.properties.start_datetime) +
              " · cloud " +
              (f.properties["eo:cloud_cover"] === undefined ? "unknown" : Number(f.properties["eo:cloud_cover"].toFixed(1)) + "%") +
              " · " +
              f.id.slice(-12),
            i,
          ),
        );
      if (!scenes.length) {
        status("No scene with cloud cover ≤60% found over this area in the last 12 months.");
        return;
      }
      await draw();
      if (validField(vertices)) loadHistory();
    } catch (e) {
      if (!signal.aborted) status("Satellite unavailable: " + e.message + ". Use Load recent satellite scenes to retry.");
    }
  }
  async function draw() {
    clearImagery();
    const version = drawVersion,
      signal = controller?.signal,
      source = collections[$("agri-satellite-source").value],
      scene = scenes[Number($("agri-scene").value)];
    if (!scene) return;
    const sensor = $("agri-satellite-source").value;
    syncModes();
    const mode = $("agri-satellite-mode").value,
      index = FIELD_INDICES[mode];
    let recipe;
    try {
      recipe = index ? recipeFor(sensor, mode, scene) : null;
    } catch (e) {
      status(e.message);
      return;
    }
    $("agri-satellite-palette").options[0].disabled = sensor === "modis";
    if (sensor === "modis") $("agri-satellite-palette").value = "continuous";
    $("agri-satellite-palette").disabled = !index;
    $("agri-index-legend").hidden = !index;
    if (index) {
      const legend = $("agri-index-legend");
      legend.replaceChildren();
      const title = document.createElement("strong");
      title.textContent = index.label + " · " + recipe.resolution;
      legend.append(title);
      const zones = $("agri-satellite-palette").value === "zones",
        ranges = [index.range[0], ...index.breaks, index.range[1]];
      for (let i = 0; i < (zones ? 4 : 0); i++) {
        const label = document.createElement("span");
        label.textContent = ranges[i] + " to " + ranges[i + 1];
        label.style.setProperty("--zone", `rgb(${indexColors(mode)[i].slice(0, 3).join(",")})`);
        legend.append(label);
      }
      if (!zones) {
        const ramp = document.createElement("span");
        ramp.className = "index-continuous-ramp";
        if (mode === "lst") ramp.style.background = "linear-gradient(90deg,#4a6dd0,#4cb894,#f4d046,#da4b31)";
        ramp.textContent = index.range[0] + " → " + index.range[1] + (index.unit ? " " + index.unit : "");
        legend.append(ramp);
      }
      const note = document.createElement("p");
      note.textContent =
        index.description +
        " " +
        recipe.note +
        (zones
          ? " Colours are fixed display zones, not calibrated crop-health classes."
          : " Continuous red → yellow → green spectral-index gradient; not a calibrated crop-health score.");
      const explanation = document.createElement("details"),
        explanationTitle = document.createElement("summary");
      explanationTitle.textContent = "Interpretation & source resolution";
      explanation.append(explanationTitle, note);
      legend.append(explanation);
      addTileHelp(legend, mode);
    }
    const u = new URL(base + "/api/data/v1/item/tilejson.json");
    u.search = new URLSearchParams({ collection: source.id, item: scene.id });
    if (recipe) {
      recipe.assets.forEach((asset) => u.searchParams.append("assets", asset));
      if (recipe.expression) u.searchParams.set("expression", recipe.expression);
      u.searchParams.set("unscale", "false");
      u.searchParams.set("rescale", recipe.range.join(","));
      if ($("agri-satellite-palette").value === "zones") {
        u.searchParams.set("expression", zoneExpression(mode, recipe.expression || "(250m_16_days_NDVI_b1*0.0001)"));
        u.searchParams.set("rescale", "0,255");
        u.searchParams.set("colormap", JSON.stringify(fieldColormap(mode)));
      } else u.searchParams.set("colormap_name", mode === "lst" ? "turbo" : "rdylgn");
    } else {
      source.assets.forEach((asset) => u.searchParams.append("assets", asset));
      if (source.red === "red") {
        u.searchParams.set("rescale", "0,0.3");
        u.searchParams.set("unscale", "true");
        u.searchParams.set("color_formula", "gamma RGB 2.2");
      }
    }
    status("Loading " + source.resolution + " satellite tiles…");
    try {
      const r = await fetch(u, { signal, cache: "no-store" });
      if (!r.ok) throw Error("Tile service returned " + r.status);
      const data = await r.json();
      if (version !== drawVersion || signal?.aborted) return;
      const tiles = data.tiles?.[0],
        bbox = data.bounds || scene.bbox;
      if (!tiles || new URL(tiles).origin !== base || bbox?.length !== 4 || !bbox.every(Number.isFinite))
        throw Error("Unexpected tile source or bounds");
      sceneBounds = L.latLngBounds([
        [bbox[1], bbox[0]],
        [bbox[3], bbox[2]],
      ]);
      outline = L.rectangle(sceneBounds, { color: "#a6dbe2", weight: 1, dashArray: "5 5", fill: false, interactive: false }).addTo(map);
      $("agri-satellite-zoom").disabled = false;
      fieldNote();
      const metadata =
        (index ? index.label : "Natural colour") +
        " · " +
        (recipe?.resolution || source.resolution) +
        " · acquisition " +
        pkt(scene.properties.datetime || scene.properties.start_datetime) +
        (scene.properties.end_datetime ? " to " + pkt(scene.properties.end_datetime) : "") +
        ". Scene cloud filtering only; cloud / shadow pixels are not masked. Spectral indices are not a disease or yield diagnosis.";
      let loaded = 0,
        failed = 0;
      const current = () => version === drawVersion;
      // Canvas clipping uses projected field vertices in tile pixel coordinates.
      // No index values or colours are invented on the client: only real image
      // tiles are painted inside the user boundary.
      const MaskedTiles = L.TileLayer.extend({
        createTile(coords, done) {
          const canvas = document.createElement("canvas"),
            size = this.getTileSize();
          canvas.width = size.x;
          canvas.height = size.y;
          const image = new Image();
          image.crossOrigin = "anonymous";
          image.onload = () => {
            if (current()) {
              const ctx = canvas.getContext("2d");
              ctx.save();
              ctx.beginPath();
              vertices.forEach(([lat, lon], i) => {
                const p = map.project([lat, lon], coords.z),
                  x = p.x - coords.x * size.x,
                  y = p.y - coords.y * size.y;
                if (i) ctx.lineTo(x, y);
                else ctx.moveTo(x, y);
              });
              ctx.closePath();
              ctx.clip();
              ctx.drawImage(image, 0, 0, size.x, size.y);
              ctx.restore();
            }
            done(null, canvas);
          };
          image.onerror = () => done(new Error("Image tile unavailable"), canvas);
          image.src = this.getTileUrl(coords);
          return canvas;
        },
      });
      const clipped = validField(vertices) && $("agri-field-clip").checked;
      const ImageTiles = clipped ? MaskedTiles : L.TileLayer;
      layer = new ImageTiles(tiles, {
        pane: "farm-imagery",
        zIndex: 300,
        bounds: sceneBounds,
        noWrap: true,
        keepBuffer: 0,
        updateWhenIdle: true,
        updateWhenZooming: false,
        maxZoom: 18,
        maxNativeZoom: source.id === "modis-11A1-061" ? 7 : source.id.startsWith("modis") ? 9 : source.red === "red" ? 13 : 14,
        opacity: Number($("agri-imagery-opacity").value) / 100,
        attribution: "Copernicus / USGS / NASA via Microsoft Planetary Computer",
      });
      layer.on("loading", () => {
        loaded = failed = 0;
        if (current()) status(metadata + " Loading scene coverage…");
      });
      layer.on("tileload", () => {
        loaded++;
      });
      layer.on("tileerror", () => {
        failed++;
      });
      layer.on("load", () => {
        if (!current()) return;
        $("agri-satellite-retry").hidden = !failed || loaded > 0;
        status(
          metadata +
            (loaded
              ? " Imagery loaded." + (failed ? " Some edge / no-data tiles are unavailable; the remaining scene is displayed." : "")
              : failed
                ? " No imagery tiles loaded in this view. Retry tiles or choose another scene."
                : " Zoom to the selected scene to view its coverage."),
        );
      });
      layer.addTo(map);
      if (!drawing && !editing) pointMode = true;
      syncModeButtons();
      if (probe) inspectPoint();
      status(metadata + (clipped ? " Clipped to the drawn boundary." : "") + " Loading scene coverage…");
      if (index && clipped && !sensor.startsWith("modis")) {
        const rgb = new URL(base + "/api/data/v1/item/tilejson.json");
        rgb.search = new URLSearchParams({ collection: source.id, item: scene.id });
        source.assets.forEach((a) => rgb.searchParams.append("assets", a));
        if (sensor === "landsat") {
          rgb.searchParams.set("unscale", "true");
          rgb.searchParams.set("rescale", "0,0.3");
          rgb.searchParams.set("color_formula", "gamma RGB 2.2");
        }
        fetch(rgb, { signal })
          .then(async (response) => {
            if (!response.ok) throw Error();
            return response.json();
          })
          .then((background) => {
            if (!current() || !background.tiles?.[0] || new URL(background.tiles[0]).origin !== base) return;
            contextLayer = L.tileLayer(background.tiles[0], {
              pane: "farm-imagery",
              zIndex: 200,
              bounds: sceneBounds,
              noWrap: true,
              keepBuffer: 0,
              maxNativeZoom: sensor === "landsat" ? 13 : 14,
              maxZoom: 18,
            }).addTo(map);
          })
          .catch(() => {});
      }
    } catch (e) {
      if (version === drawVersion && !signal?.aborted) {
        status("Satellite unavailable: " + e.message);
        $("agri-satellite-retry").hidden = false;
      }
    }
  }
  // Pixel readings request actual raw values and an independent source QA
  // band; visible RGB colours are never reverse-engineered into index values.
  async function sample(scene, point, mode, sensor, signal) {
    const recipe = recipeFor(sensor, mode, scene);
    if (!recipe) throw Error("Metric not supported by this sensor");
    const source = collections[sensor],
      key = [sensor, scene.id, point.join(","), mode, JSON.stringify(calibration())].join("|");
    if (sampleCache.has(key)) return sampleCache.get(key);
    async function pointValue(assets, expression) {
      const u = new URL(base + "/api/data/v1/item/point/" + point[1] + "," + point[0]);
      u.search = new URLSearchParams({ collection: source.id, item: scene.id, unscale: "false" });
      for (const asset of assets) u.searchParams.append("assets", asset);
      if (expression) u.searchParams.set("expression", expression);
      const r = await fetch(u, { signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(25000)]) });
      if (!r.ok) throw Error("Pixel service HTTP " + r.status);
      return rasterValue(await r.json());
    }
    const pending = (async () => {
      const qa = qualityAsset(sensor);
      if (!scene.assets?.[qa]) throw Error("Required pixel quality band unavailable");
      const quality = await pointValue([qa]);
      if (!validPixel(sensor, quality)) return null;
      let value;
      if (mode === "smi") {
        const thermal = recipeFor(sensor, "lst", scene),
          temperature = await pointValue(thermal.assets, thermal.expression);
        if (!finite(temperature) || temperature < -80 || temperature > 100) return null;
        const { wet, dry } = calibration();
        value = thermalMoistureIndex(temperature, wet, dry);
      } else value = await pointValue(recipe.assets, recipe.expression);
      if (sensor === "modis" && finite(value)) {
        if (value < -2000 || value > 10000) return null;
        value *= 0.0001;
      }
      if (!finite(value) || value < (mode === "lst" ? -80 : recipe.range[0]) || value > (mode === "lst" ? 100 : recipe.range[1]))
        return null;
      return value;
    })();
    sampleCache.set(key, pending);
    if (sampleCache.size > 2000) sampleCache.delete(sampleCache.keys().next().value);
    try {
      return await pending;
    } catch (e) {
      sampleCache.delete(key);
      throw e;
    }
  }
  function pointPopup() {
    if (!probeMarker) return;
    const content = document.createElement("div"),
      title = document.createElement("strong");
    title.textContent = "Satellite point";
    content.append(title);
    for (const child of $("agri-point-readings").children) content.append(child.cloneNode(true));
    if (!$("agri-point-readings").children.length) {
      const message = document.createElement("p");
      message.textContent = $("agri-point-readings").textContent;
      content.append(message);
    }
    if (!probeMarker.getPopup())
      probeMarker.bindPopup(content, { className: "satellite-point-popup", maxWidth: 300, minWidth: 210, autoPanPadding: [20, 65] });
    else probeMarker.setPopupContent(content);
    probeMarker.openPopup();
  }
  async function inspectPoint() {
    const version = ++probeVersion,
      scene = scenes[Number($("agri-scene").value)],
      root = $("agri-point-readings"),
      sensor = $("agri-satellite-source").value;
    root.replaceChildren();
    $("agri-point-meaning").textContent = "";
    $("agri-point-panel").hidden = false;
    if (!probe || !scene) {
      root.textContent = "Load a satellite scene, then choose a point on its imagery.";
      pointPopup();
      return;
    }
    if (sceneBounds && !sceneBounds.contains(probe)) {
      root.textContent =
        "This point is outside the selected satellite scene. Choose a point inside its dashed outline, or load a scene covering this point.";
      pointPopup();
      return;
    }
    root.textContent = "Reading source pixels and checking cloud / quality flags…";
    pointPopup();
    const currentMode = $("agri-satellite-mode").value,
      mode = currentMode === "rgb" ? "ndvi" : currentMode;
    const modes = [
      ...new Set([
        mode,
        ...(sensor === "sentinel" || sensor === "landsat" ? ["ndvi", "ndmi"] : []),
        ...(sensor === "landsat" ? ["lst"] : []),
      ]),
    ];
    const rows = await Promise.allSettled(
      modes.map(async (key) => ({ key, value: await sample(scene, probe, key, sensor, controller?.signal) })),
    );
    if (version !== probeVersion) return;
    root.replaceChildren();
    const title = document.createElement("p");
    title.textContent =
      probe[0].toFixed(5) + "°N, " + probe[1].toFixed(5) + "°E · " + pkt(scene.properties.datetime || scene.properties.start_datetime);
    root.append(title);
    let selected = null;
    for (let i = 0; i < rows.length; i++) {
      const result = rows[i],
        key = modes[i],
        p = document.createElement("p");
      p.textContent =
        FIELD_INDICES[key].label +
        ": " +
        (result.status === "fulfilled" && finite(result.value.value)
          ? result.value.value.toFixed(3) + " " + (FIELD_INDICES[key].unit || "")
          : "Unavailable · cloud / no-data, unsupported band or retrieval error");
      root.append(p);
      if (key === mode && result.status === "fulfilled") selected = result.value.value;
    }
    $("agri-point-meaning").textContent = indexMeaning(mode, selected, farmContext?.stage);
    stationContext();
    pointPopup();
  }
  function stationContext() {
    const target = $("agri-point-station"),
      s = farmContext?.observation,
      ref = probe || [place[1], place[2]];
    if (!s || Date.now() - s.time > (s.kind === "metar" ? 2 : 3) * 3600000) {
      target.textContent =
        "No fresh nearby observed report for comparison. Satellite values are not replaced with model or station values.";
      return;
    }
    const report = s.report,
      distance = distanceKm(ref[0], ref[1], { lat: report.lat, lon: report.lon });
    if (distance > 50) {
      target.textContent =
        "The selected station is " +
        distance.toFixed(1) +
        " km from this imagery point; outside the 50 km station comparison radius. Choose a closer weather location for observed context.";
      return;
    }
    const t = currentValue(s, "temperature_2m", null),
      rh = currentValue(s, "relative_humidity_2m", null),
      rain = currentValue(s, "rain_daily", null);
    target.textContent =
      "Station context: " +
      s.name +
      " · " +
      distance.toFixed(1) +
      " km from point · " +
      pkt(s.time) +
      " · air " +
      (finite(t) ? t + "°C" : "unavailable") +
      " · RH " +
      (finite(rh) ? rh + "%" : "unavailable") +
      " · daily rainfall " +
      (finite(rain) ? rain + " mm" : "unavailable") +
      ". Compare observation times; station air temperature is not satellite LST.";
  }
  async function loadStationTrend() {
    const target = $("agri-field-station-chart"),
      station = farmContext?.observation;
    target.replaceChildren();
    if (!station || station.kind !== "station") return;
    const version = historyVersion,
      signal = historyController?.signal;
    try {
      const response = await fetch("./station-history/index.json", { signal });
      if (!response.ok) throw Error();
      const manifest = await response.json(),
        entry = manifest.stations?.find(
          (s) =>
            s.name === station.name && s.lat === station.report.lat && s.lon === station.report.lon && /^[a-f0-9]{20}\.json$/.test(s.file),
        );
      if (!entry) throw Error();
      const r = await fetch("./station-history/" + entry.file, { signal });
      if (!r.ok) throw Error();
      const data = await r.json();
      if (version !== historyVersion || data.schema_version !== 1) return;
      const h = data.hourly,
        rows = (h?.time || [])
          .map((t, i) => ({ time: Date.parse(t), value: h.temperature_2m?.[i] }))
          .filter((r) => r.time >= Date.now() - HISTORY_DAYS * 86400000 && r.time <= Date.now());
      const note = document.createElement("p");
      note.className = "farm-explainer";
      note.textContent =
        station.name +
        " · " +
        rows.length +
        " recorded hourly samples. Permanent station collection began " +
        (manifest.archive_started_at ? pkt(manifest.archive_started_at) : "at archive activation") +
        ". Earlier measured history is not invented or replaced with forecasts.";
      target.append(note);
      const chart = document.createElement("div");
      target.append(chart);
      renderFieldChart(chart, rows, {
        title: "Recorded station air temperature · available history only",
        unit: "°C",
        start: Date.now() - HISTORY_DAYS * 86400000,
        color: "#efb376",
      });
    } catch {
      if (version === historyVersion)
        target.textContent =
          "Recorded station history is not yet available for this station. Current station context above retains its own observation time.";
    }
  }
  function clearHistory() {
    $("agri-field-zones").replaceChildren();
    historyController?.abort();
    historyVersion++;
    historyRows = [];
    $("agri-growth-snapshot").hidden = true;
    $("agri-zone-details").hidden = true;
    $("agri-field-history-panel").hidden = false;
    $("agri-field-history-chart").replaceChildren();
    $("agri-field-history-status").textContent = "Draw a boundary on the map or choose a saved boundary to build a 12-month report from real satellite passes.";
    $("agri-field-history-narrative").textContent = "";
    $("agri-field-station-chart").replaceChildren();
    renderDataChips(null, null);
    reportSubtitle();
  }
  // Whole-field, cloud-masked mean for one pass from the statistics service.
  async function fieldStats(scene, mode, sensor, signal) {
    const recipe = recipeFor(sensor, mode, scene),
      expression = recipe && maskedStatsExpression(sensor, recipe.expression);
    if (!expression) throw Error("Whole-field statistics are not available for this index");
    const key = ["stats", sensor, scene.id, mode, JSON.stringify(vertices)].join("|");
    if (sampleCache.has(key)) return sampleCache.get(key);
    const stored = statsStore.get(key);
    if (stored) return stored;
    const qa = qualityAsset(sensor);
    if (!scene.assets?.[qa]) throw Error("Required pixel quality band unavailable");
    const u = new URL(base + "/api/data/v1/item/statistics");
    u.search = new URLSearchParams({ collection: collections[sensor].id, item: scene.id });
    for (const asset of new Set([...recipe.assets, qa])) u.searchParams.append("assets", asset);
    u.searchParams.set("expression", expression);
    const feature = { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...vertices, vertices[0]].map(([lat, lon]) => [lon, lat])] } };
    const pending = (async () => {
      // The service rate-limits bursts with HTTP 429, sent without CORS headers, so the
      // browser sees a network error. Retry those with a growing pause before giving up.
      let r;
      for (let attempt = 0; ; attempt++) {
        try {
          r = await fetch(u, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(feature),
            signal: AbortSignal.any([signal || new AbortController().signal, AbortSignal.timeout(30000)]),
          });
          if (r.ok || (r.status !== 429 && r.status < 500)) break;
        } catch (e) {
          if (signal?.aborted || e.name === "AbortError") throw e;
        }
        if (attempt >= 4) throw Error("Statistics service unavailable after retries");
        await new Promise((done) => setTimeout(done, 1500 * 2 ** attempt + Math.random() * 500));
        if (signal?.aborted) throw new DOMException("Aborted", "AbortError");
      }
      if (!r.ok) throw Error("Statistics service HTTP " + r.status);
      const result = maskedFieldMean((await r.json()).properties?.statistics);
      const [lo, hi] = mode === "lst" ? [-80, 100] : recipe.range;
      if (finite(result.value) && (result.value < lo || result.value > hi)) result.value = null;
      statsStore.set(key, result);
      return result;
    })();
    sampleCache.set(key, pending);
    try {
      return await pending;
    } catch (e) {
      sampleCache.delete(key);
      throw e;
    }
  }
  // Past passes never change, so whole-field results are kept in this browser.
  const statsStore = {
    name: "weatherwalay-field-stats-v1",
    read() {
      try {
        return JSON.parse(localStorage.getItem(this.name)) || {};
      } catch {
        return {};
      }
    },
    get(key) {
      return this.read()[key] || null;
    },
    set(key, value) {
      try {
        const all = this.read();
        all[key] = { value: value.value, clear: value.clear, pixels: value.pixels };
        const keys = Object.keys(all);
        for (const k of keys.slice(0, Math.max(0, keys.length - 1500))) delete all[k];
        localStorage.setItem(this.name, JSON.stringify(all));
      } catch {}
    },
  };
  const usesWholeField = (sensor, mode) => ["sentinel", "landsat"].includes(sensor) && mode !== "smi";
  function fmtValue(mode, v) {
    return mode === "lst" ? v.toFixed(1) + " °C" : v.toFixed(2);
  }
  function chip(label, state, note) {
    const c = document.createElement("span");
    c.className = "data-chip";
    c.dataset.state = state;
    const icon = document.createElement("b");
    icon.textContent = state === "ok" ? "✓" : state === "partial" ? "◐" : "–";
    icon.setAttribute("aria-hidden", "true");
    const text = document.createElement("span");
    text.textContent = label;
    const small = document.createElement("small");
    small.textContent = note;
    c.append(icon, text, small);
    return c;
  }
  function renderDataChips(usable, checked) {
    const root = $("field-data-chips");
    if (!root) return;
    root.replaceChildren();
    const sat = checked == null ? ["none", "Not loaded"] : usable >= 12 ? ["ok", usable + " clear passes"] : usable > 0 ? ["partial", usable + " clear passes"] : ["none", "No clear pass"];
    const fc = farmContext?.forecast?.hourly?.time?.length,
      obs = farmContext?.observation;
    const soil = $("soil-reading-source")?.value === "sensor" ? ["ok", "Sensor connected"] : $("soil-moisture")?.value ? ["partial", "Manual reading"] : ["none", "No soil reading"];
    root.append(
      chip("Satellite", sat[0], sat[1]),
      chip("Weather", fc ? "ok" : "none", fc ? "ECMWF forecast" : "Not loaded"),
      chip("Station", obs ? "ok" : "partial", obs ? obs.name : "None nearby · model only"),
      chip("Soil", soil[0], soil[1]),
    );
  }
  function reportSubtitle() {
    const sub = $("field-report-sub");
    if (!sub) return;
    const name = $("farm-boundary-name")?.value.trim(),
      area = validField(vertices) ? fieldAreaHa(vertices) : null,
      crop = farmContext?.crop?.name;
    sub.textContent = [name || "Drawn field", crop, finite(area) ? area.toLocaleString("en-GB", { maximumFractionDigits: 1 }) + " ha" : null, place[0]].filter(Boolean).join(" · ");
  }
  function snapshotCards(mode, rows, usable, checked, whole) {
    const root = $("agri-growth-snapshot");
    root.replaceChildren();
    const summary = fieldChangeSummary(rows);
    root.hidden = !summary;
    if (!summary) return;
    const valid = rows.filter((r) => finite(r.value)),
      peak = valid.reduce((a, b) => (b.value > a.value ? b : a)),
      low = valid.reduce((a, b) => (b.value < a.value ? b : a)),
      label = FIELD_INDICES[mode].label.split(" · ")[0];
    const cards = [
      ["Latest " + label, fmtValue(mode, summary.latest.value), (whole ? "Whole-field mean · " : "Sampled mean · ") + pkt(summary.latest.time), "hero"],
      [
        "Change",
        finite(summary.change) ? (summary.change >= 0 ? "+" : "−") + fmtValue(mode, Math.abs(summary.change)) : "—",
        summary.previous ? "vs. clear pass " + summary.days + " days earlier" : "Needs two clear passes",
      ],
      ["12-month range", fmtValue(mode, low.value) + " – " + fmtValue(mode, peak.value), "Peak " + pkt(peak.time)],
      ["Clear passes", usable + " / " + checked, whole ? "≥60% of field clear" : "≥60% of sample points clear"],
    ];
    for (const [title, value, note, kind] of cards) {
      const card = document.createElement("article");
      card.className = "growth-snapshot-card" + (kind ? " growth-snapshot-" + kind : "");
      for (const [tag, text] of [["span", title], ["strong", value], ["small", note]]) {
        const n = document.createElement(tag);
        n.textContent = text;
        card.append(n);
      }
      root.append(card);
    }
  }
  async function loadHistory() {
    $("agri-field-zones").replaceChildren();
    $("agri-field-history-chart").replaceChildren();
    $("agri-field-history-narrative").textContent = "";
    $("agri-growth-snapshot").hidden = true;
    $("agri-zone-details").hidden = true;
    historyController?.abort();
    historyController = new AbortController();
    const signal = historyController.signal,
      version = ++historyVersion,
      root = $("agri-field-history-status");
    reportSubtitle();
    if (!validField(vertices)) {
      clearHistory();
      return;
    }
    const sensor = $("agri-satellite-source").value,
      mode = historyMode(),
      whole = usesWholeField(sensor, mode),
      days = thinPasses(recentSceneDays(scenes, Date.now(), HISTORY_DAYS)),
      points = fieldSamplePoints(vertices);
    if (!whole && !points.length) {
      root.textContent = "No reliable interior sample positions found. Adjust this boundary.";
      return;
    }
    if (mode === "smi" && (!finite(calibration().wet) || !finite(calibration().dry) || calibration().dry - calibration().wet < 5)) {
      root.textContent =
        "SMI history needs locally calibrated wet and dry LST endmembers at least 5°C apart. Enter them under Display settings; values are not guessed.";
      return;
    }
    root.textContent = "Building the 12-month field report…";
    renderDataChips(null, null);
    loadStationTrend();
    const results = [];
    let cursor = 0,
      done = 0;
    async function worker() {
      while (cursor < days.length && !signal.aborted) {
        const [date, scene] = days[cursor++],
          time = Date.parse(scene.properties.datetime || scene.properties.start_datetime);
        if (whole) {
          try {
            const r = await fieldStats(scene, mode, sensor, signal);
            results.push({ date, time, value: r.value, clear: r.clear, pixels: r.pixels, scene: scene.id });
          } catch {
            if (signal.aborted) return;
            results.push({ date, time, value: null, failed: true, scene: scene.id });
          }
        } else {
          const values = await Promise.allSettled(points.map((p) => sample(scene, p, mode, sensor, signal)));
          if (signal.aborted) return;
          const valid = values.flatMap((r) => (r.status === "fulfilled" && finite(r.value) ? [r.value] : [])),
            enough = valid.length >= Math.ceil(points.length * MIN_CLEAR_FRACTION);
          results.push({
            date,
            time,
            value: enough ? valid.reduce((a, b) => a + b, 0) / valid.length : null,
            min: enough ? Math.min(...valid) : null,
            max: enough ? Math.max(...valid) : null,
            samples: points.map((point, i) => ({ point, value: values[i].status === "fulfilled" ? values[i].value : null })),
            count: valid.length,
            expected: points.length,
            scene: scene.id,
          });
        }
        root.textContent = "Building the 12-month field report: " + ++done + " / " + days.length + " passes checked…";
        // Draw the chart as passes arrive so the report is never blank while it loads.
        if (done % 8 === 0 && version === historyVersion)
          renderFieldChart($("agri-field-history-chart"), [...results].sort((a, b) => a.time - b.time), {
            title: FIELD_INDICES[mode].label + " · loading…",
            unit: FIELD_INDICES[mode].unit || "",
            start: Date.now() - HISTORY_DAYS * 86400000,
            color: mode === "lst" ? "#f0a26c" : "#5fbf6a",
          });
      }
    }
    await Promise.all(Array.from({ length: 2 }, worker));
    if (version !== historyVersion || signal.aborted) return;
    historyRows = results.sort((a, b) => a.time - b.time);
    const usable = historyRows.filter((r) => finite(r.value)).length,
      failed = historyRows.filter((r) => r.failed).length;
    renderFieldChart($("agri-field-history-chart"), historyRows, {
      title: FIELD_INDICES[mode].label + (whole ? " · whole-field mean" : " · sampled field trend"),
      unit: FIELD_INDICES[mode].unit || "",
      start: Date.now() - HISTORY_DAYS * 86400000,
      color: mode === "lst" ? "#f0a26c" : "#5fbf6a",
    });
    snapshotCards(mode, historyRows, usable, days.length, whole);
    renderDataChips(usable, days.length);
    // Within-field differences: five interior points on the latest clear pass.
    const zoneRoot = $("agri-field-zones");
    zoneRoot.replaceChildren();
    const latestClear = historyRows.filter((r) => finite(r.value)).at(-1);
    if (mode === "ndvi" && latestClear && points.length) {
      let samples = latestClear.samples;
      if (!samples) {
        const scene = scenes.find((f) => f.id === latestClear.scene),
          values = scene ? await Promise.allSettled(points.map((p) => sample(scene, p, mode, sensor, signal))) : [];
        if (version !== historyVersion || signal.aborted) return;
        samples = points.map((point, i) => ({ point, value: values[i]?.status === "fulfilled" ? values[i].value : null }));
      }
      $("agri-zone-details").hidden = false;
      const assessment = vegetationSamples(samples, { stage: farmContext?.stage }),
        heading = document.createElement("h4");
      heading.textContent = "Within-field comparison · " + pkt(latestClear.time);
      zoneRoot.append(heading);
      const note = document.createElement("p");
      note.textContent = assessment.note;
      zoneRoot.append(note);
      if (assessment.ready)
        for (const [i, s] of assessment.samples.entries()) {
          const row = document.createElement("p");
          row.className = "field-zone-sample";
          row.dataset.zone = s.zone.includes("Lower") ? "lower" : s.zone.includes("Higher") ? "higher" : "typical";
          row.textContent = "Point " + (i + 1) + " · NDVI " + s.value.toFixed(2) + " · " + s.zone;
          const locate = document.createElement("button");
          locate.type = "button";
          locate.textContent = "Show on map";
          locate.setAttribute("aria-label", "Show point " + (i + 1) + " on the map");
          locate.addEventListener("click", () => {
            drawing = false;
            editing = false;
            pointMode = true;
            $("agri-field-draw").textContent = "Draw field boundary";
            syncModeButtons();
            syncBoundary(false);
            map.panTo(s.point);
            map.fire("click", { latlng: L.latLng(s.point) });
            $("agri-satellite-map").scrollIntoView({ block: "center", behavior: "smooth" });
          });
          row.append(document.createTextNode(" "), locate);
          zoneRoot.append(row);
        }
    }
    root.textContent = days.length
      ? usable + " of " + days.length + " passes over the last 12 months were clear enough to use" + (failed ? "; " + failed + " could not be read and stay as gaps" : "") + ". Gaps mean cloud or no data, not poor growth."
      : "No pass with cloud cover ≤60% over this field in the last 12 months." + (sensor === "modis" ? " MODIS NDVI is a 16-day composite." : "");
    if (mode === "smi") root.textContent += " SMI uses the same user-supplied endmembers across dates.";
    $("agri-field-history-narrative").textContent =
      mode === "ndvi" || mode === "evi" || mode === "savi"
        ? historyNarrative(historyRows, farmContext || {})
        : "This is a " + FIELD_INDICES[mode].label + " record. Switch the graph to NDVI for a crop-development reading; thermal and water indices alone cannot show sowing or harvest.";
  }
  addTileHelp($("agri-point-panel"), "point");
  addTileHelp($("agri-field-history-panel"), "history");
  $("agri-satellite-load").addEventListener("click", load);
  $("agri-satellite-source").addEventListener("change", () => {
    historyController?.abort();
    $("agri-smi-wet").value = $("agri-smi-dry").value = "";
    syncModes();
    load();
  });
  for (const id of ["agri-satellite-mode", "agri-scene", "agri-satellite-palette", "agri-field-clip", "agri-smi-wet", "agri-smi-dry"])
    $(id).addEventListener("change", () => {
      syncModes();
      draw();
      if (validField(vertices)) loadHistory();
    });
  $("agri-satellite-retry").addEventListener("click", draw);
  $("agri-satellite-zoom").addEventListener("click", () => {
    if (sceneBounds) map.fitBounds(sceneBounds, { padding: [18, 18], maxZoom: 12 });
  });
  $("agri-imagery-opacity").addEventListener("input", () => {
    layer?.setOpacity(Number($("agri-imagery-opacity").value) / 100);
  });
  // Google satellite comes only through the official Map Tiles API: a session token from
  // createSession, then 2D tiles. The key lives in maps-config.json and must be restricted
  // to this site's address in Google Cloud. Without a key the map falls back to Esri imagery.
  let googleTiles = null;
  async function googleTileUrl() {
    if (googleTiles && googleTiles.expiry > Date.now() + 60000) return googleTiles.url;
    const config = await fetch("./maps-config.json", { cache: "no-store" }).then((r) => (r.ok ? r.json() : {})).catch(() => ({}));
    const key = typeof config.googleMapsApiKey === "string" ? config.googleMapsApiKey.trim() : "";
    if (!key) return null;
    const r = await fetch("https://tile.googleapis.com/v1/createSession?key=" + encodeURIComponent(key), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mapType: "satellite", language: "en-US", region: "PK", layerTypes: ["layerRoadmap"] }),
    });
    if (!r.ok) throw Error("Google Map Tiles session failed (" + r.status + ")");
    const d = await r.json();
    googleTiles = {
      url: "https://tile.googleapis.com/v1/2dtiles/{z}/{x}/{y}?session=" + encodeURIComponent(d.session) + "&key=" + encodeURIComponent(key),
      expiry: d.expiry ? Number(d.expiry) * 1000 : Date.now() + 3600000,
    };
    return googleTiles.url;
  }
  let basemapVersion = 0;
  async function applyBasemap() {
    ensureMap();
    const version = ++basemapVersion;
    let choice = $("agri-basemap").value,
      url = null,
      note = "";
    if (choice === "google") {
      try {
        url = await googleTileUrl();
      } catch (e) {
        note = e.message + ". ";
      }
      if (!url) {
        choice = "imagery";
        note += "Google satellite needs a Map Tiles API key in maps-config.json; showing Esri imagery instead.";
      }
    }
    if (version !== basemapVersion) return;
    for (const l of Object.values(map._layers)) if (l.options?.pane === "dark-base") map.removeLayer(l);
    map.getPane("dark-base").classList.toggle("dark-osm-basemap", choice === "dark");
    const layers = {
      google: [url, 22, 22, "Map data ©" + new Date().getFullYear() + " Google · Imagery ©" + new Date().getFullYear() + " Google"],
      imagery: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", 19, 18, "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics and the GIS User Community"],
      dark: ["https://tile.openstreetmap.org/{z}/{x}/{y}.png", 19, 19, "© OpenStreetMap contributors"],
    };
    const [tiles, maxZoom, maxNativeZoom, attribution] = layers[choice];
    L.tileLayer(tiles, { pane: "dark-base", maxZoom, maxNativeZoom, attribution }).addTo(map);
    const hint = $("agri-basemap-note");
    if (hint) {
      hint.textContent = note;
      hint.hidden = !note;
    }
  }
  $("agri-basemap").addEventListener("change", applyBasemap);
  $("agri-field-draw").addEventListener("click", () => {
    ensureMap();
    if (!drawing) {
      map.closePopup();
      editing = false;
      pointMode = false;
      syncModeButtons();
    }
    drawing = !drawing;
    if (!drawing) pointMode = true;
    syncModeButtons();
    $("agri-field-draw").textContent = drawing ? "Finish boundary" : "Draw field boundary";
    syncBoundary(!drawing);
    if (!drawing && validField(vertices)) $("agri-satellite-load").textContent = "Load scenes for boundary";
  });
  function syncModeButtons() {
    $("agri-field-edit").setAttribute("aria-pressed", String(editing));
    $("agri-point-toggle").setAttribute("aria-pressed", String(pointMode));
    $("agri-point-toggle").textContent = pointMode ? "⌖ Point picker on" : "⌖ Inspect point";
    $("agri-point-toggle").title = pointMode ? "Turn off point picking" : "Select a satellite pixel";
    $("agri-point-hint").hidden = !pointMode;
    if (map) map.getContainer().classList.toggle("point-inspecting", pointMode);
  }
  $("agri-field-edit").addEventListener("click", () => {
    ensureMap();
    drawing = false;
    pointMode = false;
    map.closePopup();
    editing = !editing;
    if (!editing) pointMode = true;
    $("agri-field-draw").textContent = "Draw field boundary";
    syncModeButtons();
    if (editing && validField(vertices)) map.fitBounds(L.latLngBounds(vertices), { padding: [55, 55], maxZoom: 17, animate: false });
    syncBoundary(false);
  });
  $("agri-point-toggle").addEventListener("click", () => {
    ensureMap();
    drawing = false;
    editing = false;
    pointMode = !pointMode;
    $("agri-point-panel").hidden = !pointMode && !probe;
    $("agri-field-draw").textContent = "Draw field boundary";
    syncModeButtons();
    syncBoundary(false);
  });
  $("agri-field-delete-point").addEventListener("click", removePoint);
  $("agri-field-remove-last").addEventListener("click", removeLast);
  $("agri-field-undo").addEventListener("click", () => {
    if (!undo.length) return;
    redo.push(vertices.map((p) => [...p]));
    vertices = undo.pop();
    syncBoundary(!drawing);
  });
  $("agri-field-redo").addEventListener("click", () => {
    if (!redo.length) return;
    undo.push(vertices.map((p) => [...p]));
    vertices = redo.pop();
    syncBoundary(!drawing);
  });
  $("agri-field-fit").addEventListener("click", () => {
    if (validField(vertices)) map.fitBounds(L.latLngBounds(vertices), { padding: [30, 30], maxZoom: 17 });
  });
  $("agri-field-clear").addEventListener("click", () => {
    if (vertices.length) snapshot();
    vertices = [];
    drawing = editing = false;
    pointMode = !!scenes.length;
    syncModeButtons();
    if (map) syncBoundary();
    $("agri-field-draw").textContent = "Draw field boundary";
    $("agri-satellite-load").textContent = "Load recent satellite scenes";
    clearHistory();
  });
  for (const id of ["agri-field-draw", "agri-field-edit", "agri-point-toggle", "agri-field-fit"])
    $(id).addEventListener("click", () => {
      $("agri-field-menu").open = false;
    });
  $("agri-history-mode").addEventListener("change", () => {
    syncModes();
    if (validField(vertices)) loadHistory();
  });
  $("agri-field-history-load").addEventListener("click", () => {
    if (!scenes.length) load();
    else loadHistory();
  });
  return {
    show() {
      ensureMap();
      map.invalidateSize();
      if (!layer) map.setView([place[1], place[2]], 11);
    },
    setContext(next) {
      farmContext = next;
      stationContext();
      reportSubtitle();
      renderDataChips(historyRows.length ? historyRows.filter((r) => finite(r.value)).length : null, historyRows.length || null);
      if (historyRows.length && historyMode() === "ndvi")
        $("agri-field-history-narrative").textContent = historyNarrative(historyRows, next);
    },
    setLocation(next) {
      controller?.abort();
      historyController?.abort();
      place = next;
      refreshLibrary();
      $("farm-boundary-name").value = "";
      $("farm-boundary-status").textContent = "Saved boundaries are listed for " + place[0] + ". Stored in this browser only.";
      scenes = [];
      $("agri-smi-wet").value = $("agri-smi-dry").value = "";
      clearImagery();
      $("agri-field-clear").click();
      undo = [];
      redo = [];
      $("agri-point-panel").hidden = true;
      probe = null;
      probeVersion++;
      if (probeMarker) map?.removeLayer(probeMarker);
      probeMarker = null;
      $("agri-point-readings").textContent = "Choose an imagery point for this location.";
      $("agri-point-meaning").textContent = "";
      if (map) {
        map.setView([place[1], place[2]], 11);
        if (marker) map.removeLayer(marker);
        marker = L.circleMarker([place[1], place[2]], { radius: 5, color: "#fff" }).addTo(map);
      }
      fieldNote();
      status("Choose a sensor and load recent scenes for " + place[0] + ". Acquisition times are PKT; imagery is not live.");
    },
  };
}
