import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves a project site from a subpath, so assets must be relative.
// A custom domain (CNAME) serves from the root and both work with './'.
export default defineConfig({
  base: './',
  plugins: [react()],
  // Fajil's own ports, deliberately not the 5173/3001 defaults: the studio's other
  // game already sits there, and a second server started on a taken port fails with
  // EADDRINUSE and *exits silently* — leaving you debugging against code that is
  // not running.
  server: {
    port: 5273,
    strictPort: true,
    host: true, // real phones on the LAN need to reach the dev server
    proxy: {
      '/socket.io': { target: 'http://localhost:3101', ws: true },
    },
  },
});
