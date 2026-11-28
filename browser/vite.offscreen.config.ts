import { defineConfig } from "vite"

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "chrome116",
    lib: {
      entry: "src/offscreen.ts",
      formats: ["iife"],
      name: "PiBrowserOffscreen",
      fileName: () => "assets/offscreen.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
})
