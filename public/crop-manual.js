import { CROP_MANUALS } from "./crop-manual-data.js";
const element = (tag, className, text) => {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
export function manualForContext(context) {
  const manual = CROP_MANUALS[context?.crop?.id];
  if (!manual) return null;
  // District workbook windows qualify timing only; they do not establish that a
  // field was planted or turn broad weather forecasts into a measured stage.
  const windows = context.field?.records?.map((r) => r.dates).filter(Boolean) || [];
  return {
    ...manual,
    stages: manual.stages.map((stage) => ({
      ...stage,
      timing:
        stage.number === 2 && windows.length
          ? stage.timing +
            ". Supplied district reference for " +
            context.place[0] +
            ": " +
            [...new Set(windows)].join("; ") +
            ". Confirm the planting system and actual field date."
          : stage.timing,
    })),
  };
}
export function manualText(context, manual = manualForContext(context)) {
  if (!manual) return "Select a crop to view its advisory.";
  const text = [context.crop.name + " · Farmers’ advisory", context.place[0] + " · crop-cycle reference, not a live district prescription", ""];
  for (const s of manual.stages)
    text.push(
      "## 🌾 Stage " + s.number + ": " + s.name,
      "* Objective: " + s.objective,
      "* Timing: " + s.timing,
      "* Actionable Steps:",
      ...s.actions.map((a) => "  - " + a),
      "* Technical Parameters: " + s.technical,
      "* Critical Danger/Warning: " + s.warning,
      "",
    );
  text.push(
    "Source: " + manual.source.name + " — " + manual.source.url,
    "Source reviewed: " + manual.source.reviewed,
    manual.source.scope,
    "Chemical products, doses and pre-harvest intervals require the currently registered local label. Soil-test nutrient recommendations and local extension advice take precedence.",
  );
  return text.join("\n");
}
export function initCropManual(root) {
  let lastKey = "";
  return {
    update(context) {
      const key = JSON.stringify([
        context.crop?.id,
        context.stage,
        context.field?.verified,
        context.field?.blocked,
        context.place[0],
        context.field?.records?.map((r) => r.dates),
      ]);
      if (key === lastKey) return;
      lastKey = key;
      root.replaceChildren();
      const manual = manualForContext(context);
      if (!manual) {
        root.append(element("p", "farm-explainer", "Choose your crop above to see the advice for its current stage."));
        return;
      }
      // Only the current stage is shown. Future stages are not rendered, so the advisory
      // never reads as if a later stage has already started.
      const current = manual.stages.filter((s) => s.group === context.stage);
      const header = element("div", "crop-manual-heading"),
        heading = element("div");
      const position = current.length
        ? "Stage " + current.map((s) => s.number).join("–") + " of " + manual.stages.length
        : "Stage not set";
      heading.append(element("span", "eyebrow", "CURRENT STAGE · " + position.toUpperCase()), element("h3", "", context.crop.name + " · what to do now"));
      const download = element("button", "", "Download this stage");
      download.type = "button";
      download.disabled = !current.length;
      download.addEventListener("click", () => {
        const url = URL.createObjectURL(new Blob([manualText(context, { ...manual, stages: current })], { type: "text/plain;charset=utf-8" })),
          a = document.createElement("a");
        a.href = url;
        a.download = context.crop.id + "-current-stage-advisory.txt";
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      });
      header.append(heading, download);
      root.append(header);
      if (current.length) {
        const progress = element("div", "crop-stage-progress");
        progress.setAttribute("role", "img");
        progress.setAttribute("aria-label", position);
        for (const stage of manual.stages) {
          const dot = element("span");
          dot.dataset.state = stage.number < current[0].number ? "done" : current.includes(stage) ? "current" : "next";
          progress.append(dot);
        }
        root.append(progress);
      }
      const basis = context.field?.blocked
        ? "The selected stage needs confirmation for this crop and season. Set the actual field stage above."
        : context.field?.verified
          ? "Based on the field stage you selected."
          : "Based on the seasonal calendar for this area. Set the actual field stage above if your crop is ahead or behind.";
      if (!current.length) {
        root.append(element("p", "agri-callout", "Set the actual field stage above to see the advice for your crop right now."));
      } else root.append(element("p", "farm-explainer", basis));
      for (const stage of current) {
        const card = element("article", "crop-manual-stage crop-manual-current");
        card.dataset.stage = String(stage.number);
        card.append(element("h4", "", "Stage " + stage.number + ": " + stage.name));
        const content = element("div", "crop-stage-content");
        const point = (label, text) => {
          const p = element("p"),
            strong = element("strong", "", label + ": ");
          p.append(strong, document.createTextNode(text));
          return p;
        };
        content.append(point("Objective", stage.objective), point("Timing", stage.timing));
        const actions = element("div", "crop-stage-actions");
        actions.append(element("strong", "", "Actions"));
        const list = element("ul");
        for (const step of stage.actions) list.append(element("li", "", step));
        actions.append(list);
        content.append(actions, point("Technical parameters", stage.technical));
        const warning = element("p", "crop-stage-warning");
        warning.append(element("strong", "", "Caution: "), document.createTextNode(stage.warning));
        content.append(warning);
        card.append(content);
        root.append(card);
      }
      const source = element("details", "crop-manual-sources"),
        sourceTitle = element("summary", "", "Sources, scope & local adjustments"),
        link = element("a", "", manual.source.name);
      link.href = manual.source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      source.append(
        sourceTitle,
        link,
        element("p", "", manual.source.scope + " Retrieved " + manual.source.reviewed + "."),
        element(
          "p",
          "",
          "Priority: your district sowing reference and current extension advice → the actual cultivar / establishment method → soil / leaf tests and registered product labels. Crop risks listed in the source include " +
            manual.risk +
            ". Weather screens are the app’s planning rules, not official pesticide thresholds.",
        ),
      );
      root.append(source);
    },
  };
}
