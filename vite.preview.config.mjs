import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const root = path.dirname(fileURLToPath(import.meta.url));
const previewRoot = path.join(root, 'src', 'preview');
const normalized = value => value.replaceAll('\\', '/').split('?')[0];

export const previewReplacement = source => {
  const id = normalized(source);
  if (/(?:^|\/)customSupabaseClient(?:\.[jt]sx?)?$/.test(id)) return path.join(previewRoot, 'supabasePreviewClient.js');
  if (/(?:^|\/)SupabaseAuthContext(?:\.[jt]sx?)?$/.test(id)) return path.join(previewRoot, 'PreviewAuth.jsx');
  return null;
};

const isolation = {
  name: 'ekv-isolated-ui-preview',
  enforce: 'pre',
  resolveId: previewReplacement,
  load(id) {
    if (/\/src\/(lib\/customSupabaseClient|contexts\/SupabaseAuthContext)\.[jt]sx?$/.test(normalized(id))) {
      throw new Error('Preview isolation failed: production backend module must never be loaded.');
    }
  },
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      res.setHeader('X-EKV-Preview', 'fixtures-only');
      if (req.headers.accept?.includes('text/html') && !path.extname((req.url || '/').split('?')[0])) {
        req.url = `/preview.html${(req.url || '').includes('?') ? `?${req.url.split('?')[1]}` : ''}`;
      }
      next();
    });
  },
};

// This config is opt-in. Normal vite.config.js/index.html are never modified.
export default defineConfig({
  plugins: [isolation, react()],
  envDir: path.join(previewRoot, '.no-env'),
  envPrefix: 'EKV_PREVIEW_',
  resolve: { alias: { '@': path.join(root, 'src') }, extensions: ['.jsx', '.js', '.tsx', '.ts', '.json'] },
  server: { host: '127.0.0.1', port: 4174, strictPort: true, cors: false },
  preview: { host: '127.0.0.1', port: 4174, strictPort: true },
  build: {
    outDir: 'build/ui-preview',
    rollupOptions: { input: path.join(root, 'preview.html') },
  },
});
