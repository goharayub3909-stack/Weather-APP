// Tailwind is scoped to the Farmers workspace (#fw-root), the Health panel (#health) and the Climate panel (#climate), the FloodAI panel (#flood), and its
// CSS reset is off, so the rest of the site keeps its existing styles. Rebuild with: npm run build:css
module.exports = {
  important: ':is(#fw-root, #health, #climate, #flood)',
  corePlugins: { preflight: false },
  content: ['./public/index.html', './public/farm-workspace.js', './public/health-panel.js', './public/climate-panel.js', './public/flood-panel.js', './public/flood-eo-panel.js'],
  theme: { extend: { fontFamily: { sans: ['"DM Sans"', 'Arial', 'sans-serif'], display: ['Manrope', 'Arial', 'sans-serif'] } } },
  plugins: [],
};
