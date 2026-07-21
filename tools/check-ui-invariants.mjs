import fs from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const read = (relativePath) => fs.readFileSync(path.join(root, relativePath), 'utf8');
const failures = [];
const assert = (condition, message) => {
  if (!condition) failures.push(message);
};

const app = read('src/App.jsx');
const sidebar = read('src/components/Sidebar.jsx');
const dashboard = read('src/components/Dashboard.jsx');
const billing = read('src/components/BillingTracker.jsx');
const invoicePreview = read('src/components/InvoicePreview.jsx');
const viteConfig = read('vite.config.js');
const portalStatusChart = read('src/components/PortalStatusChart.jsx');
const projectStatusChart = read('src/components/ProjectStatusChart.jsx');

assert(!app.includes('localStorage.clear()'), 'Reset relace nesmí smazat všechna lokální UI nastavení.');
assert(app.includes('<Route path="*" element={<NotFound />} />'), 'Přihlášené routy musí mít 404 fallback.');
assert(!app.includes('false && loading'), 'V App.jsx zůstal mrtvý loader branch.');
assert(!billing.includes('window.confirm(') && !invoicePreview.includes('window.confirm('), 'Finanční workflow nesmí používat nativní window.confirm.');
assert(!sidebar.includes('<NavLink\n      to={item.path}') || !sidebar.includes('onToggleFavorite(item.path);'), 'Oblíbená akce nesmí být tlačítko vnořené do odkazu.');
assert(dashboard.includes('isAdmin, isPrivateMode, stageSummary, summary'), 'Soukromý režim musí být závislostí dashboardových výpočtů.');
assert(dashboard.includes('Promise.all(commonQueries)') && dashboard.includes('Promise.all(memberQueries)'), 'Dashboardové datové skupiny musí běžet paralelně.');
assert(!viteConfig.includes('console.warn = () => {}'), 'Build nesmí globálně potlačovat varování.');
assert((portalStatusChart.match(/'?Nové'?: \{ color:/g) || []).length === 1, 'PortalStatusChart obsahuje duplicitní stav Nové.');
assert((projectStatusChart.match(/'?Nové'?: \{ color:/g) || []).length === 1, 'ProjectStatusChart obsahuje duplicitní stav Nové.');
assert((portalStatusChart.match(/'V řešení': \{ color:/g) || []).length === 1, 'PortalStatusChart obsahuje duplicitní stav V řešení.');
assert((projectStatusChart.match(/'V řešení': \{ color:/g) || []).length === 1, 'ProjectStatusChart obsahuje duplicitní stav V řešení.');

if (failures.length) {
  console.error('UI invariant checks failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('UI accessibility, routing and state invariants passed.');
