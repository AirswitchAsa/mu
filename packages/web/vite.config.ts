import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * µ web client. Dev server talks to the µ backend (CORS-open) at VITE_MU_API
 * (default http://127.0.0.1:4000). Charts are client-side renderer plugins loaded
 * via import.meta.glob — no separate build step, just drop a folder under
 * src/renderers/ and it registers (the "loaded like resources" pattern).
 */
export default defineConfig({
  plugins: [react()],
  server: { port: 5173 },
});
