import React from 'react';
import ReactDOM from 'react-dom/client';
import { installPreviewClock, PREVIEW_DATE, getPreviewRole, setPreviewRole } from './previewState.js';
import { resetPreviewData } from './supabasePreviewClient.js';
import '../index.css';
import '../styles/portal.css';
import './preview.css';

const nativeFetch = window.fetch.bind(window);
window.fetch = (input, options) => {
  const url = new URL(input instanceof Request ? input.url : input, window.location.href);
  if (url.origin !== window.location.origin) return Promise.reject(new Error('Ukázkový náhled blokuje externí síťové požadavky.'));
  return nativeFetch(input, options);
};
installPreviewClock();
if (window.location.pathname === '/preview.html') window.history.replaceState(null, '', `/${window.location.search}${window.location.hash}`);
window.__EKV_PREVIEW__ = Object.freeze({ fixturesOnly: true, date: PREVIEW_DATE, getRole: getPreviewRole, setRole: setPreviewRole, resetData: resetPreviewData });

async function render() {
  const { default: App } = await import('../App.jsx');
  ReactDOM.createRoot(document.getElementById('root')).render(<App />);
}
void render();
