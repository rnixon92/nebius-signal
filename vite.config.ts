import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Relative base so the build works at any path (GitHub Pages project sites, file hosting).
export default defineConfig({
  base: "./",
  plugins: [react(), tailwindcss()],
});
