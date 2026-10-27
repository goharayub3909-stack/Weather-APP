// Tailwind is scoped to the Farmers workspace (#fw-root) and its CSS reset is off,
// so the rest of the site keeps its existing styles. Rebuild with: npm run build:css
module.exports = {
  important: '#fw-root',
  corePlugins: { preflight: false },
  content: ['./public/index.html', './public/farm-workspace.js'],
  theme: { extend: { fontFamily: { sans: ['"DM Sans"', 'Arial', 'sans-serif'], display: ['Manrope', 'Arial', 'sans-serif'] } } },
  plugins: [],
};
