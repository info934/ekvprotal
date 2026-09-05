const query = typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search);
const requestedDate = query.get('previewDate');
export const PREVIEW_DATE = /^\d{4}-\d{2}-\d{2}$/.test(requestedDate || '') ? requestedDate : '2026-09-05';
let role = query.get('previewRole') === 'member' ? 'member' : 'admin';
const listeners = new Set();
export const getPreviewRole = () => role;
export const subscribePreviewRole = callback => { listeners.add(callback); return () => listeners.delete(callback); };
export const setPreviewRole = next => {
  role = next === 'member' ? 'member' : 'admin';
  listeners.forEach(listener => listener());
};
export const previewDate = (offset = 0) => {
  const date = new Date(`${PREVIEW_DATE}T12:00:00`);
  date.setDate(date.getDate() + offset);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

export const installPreviewClock = () => {
  const NativeDate = globalThis.Date;
  const elapsedStart = NativeDate.now();
  const clockStart = new NativeDate(`${PREVIEW_DATE}T09:00:00`).getTime();
  globalThis.Date = class PreviewDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [clockStart + NativeDate.now() - elapsedStart])); }
    static now() { return clockStart + NativeDate.now() - elapsedStart; }
  };
};
