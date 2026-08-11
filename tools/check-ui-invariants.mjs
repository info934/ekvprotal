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
const sharePointFolderBrowser = read('src/components/SharePointFolderBrowser.jsx');
const sourceFiles = [];
const collectSourceFiles = (directory) => {
  fs.readdirSync(directory, { withFileTypes: true }).forEach((entry) => {
    const absolutePath = path.join(directory, entry.name);
    if (entry.isDirectory()) collectSourceFiles(absolutePath);
    else if (/\.(?:js|jsx|ts|tsx)$/.test(entry.name)) sourceFiles.push(absolutePath);
  });
};
collectSourceFiles(path.join(root, 'src'));
const mojibakePattern = /(?:Ã|Â|Ä|Ĺ|Ă|â€|�)/;
const mojibakeFiles = sourceFiles
  .filter((filePath) => mojibakePattern.test(fs.readFileSync(filePath, 'utf8')))
  .map((filePath) => path.relative(root, filePath));

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
assert(mojibakeFiles.length === 0, `Zdrojové soubory obsahují poškozené UTF-8 řetězce: ${mojibakeFiles.join(', ')}`);

assert(!sharePointFolderBrowser.includes('file instanceof File'), 'SharePoint upload must not confuse the global File API with a React icon.');
assert(sharePointFolderBrowser.includes('File as FileIcon'), 'The SharePoint file icon must use a non-conflicting alias.');

if (failures.length) {
  console.error('UI invariant checks failed:');
  failures.forEach((failure) => console.error(`- ${failure}`));
  process.exit(1);
}

console.log('UI accessibility, routing and state invariants passed.');
