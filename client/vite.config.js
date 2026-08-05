import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// GitHub Pages serves a project site from a subpath, so assets must be relative.
// A custom domain (CNAME) serves from the root and both work with './'.
export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    port: 5173,
    host: true, // real phones on the LAN need to reach the dev server
    proxy: {
      '/socket.io': { target: 'http://localhost:3001', ws: true },
    },
  },
});
