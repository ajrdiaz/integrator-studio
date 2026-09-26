import path from "node:path";
import { defineConfig } from "vite";

// Interfaz local. En desarrollo (npm run web:dev) la API corre aparte en :3000.
export default defineConfig({
  root: path.resolve(import.meta.dirname),
  publicDir: path.resolve(import.meta.dirname, "../assets"),
  build: { outDir: "dist", emptyOutDir: true, chunkSizeWarningLimit: 2000 },
  server: {
    port: 5173,
    proxy: { "/api": "http://127.0.0.1:3000", "/jobs": "http://127.0.0.1:3000" },
  },
});
