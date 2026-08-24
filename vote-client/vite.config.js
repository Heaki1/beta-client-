import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Builds straight into the Express public folder, so the server serves the
// app at /vote with no extra hosting. Vite and React live in "dependencies"
// (not devDependencies) on purpose: Render installs with NODE_ENV=production,
// which would otherwise skip the build tooling.
export default defineConfig({
  plugins: [react()],
  base: "/vote/",
  build: {
    outDir: "../public/vote",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    // `npm run dev:client` from the project root gives hot reload while the
    // real Express server keeps serving /api on port 3000.
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: false },
    },
  },
});
