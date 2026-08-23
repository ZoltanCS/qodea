import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  // relative asset paths — required for the packaged (file://) Electron build
  base: './',
  plugins: [react()],
  server: {
    // Fixed port so the Electron shell always talks to the right dev server;
    // if it's taken (stale process), fail loudly instead of silently shifting.
    port: 5173,
    strictPort: true,
  },
});
