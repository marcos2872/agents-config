import { defineConfig } from "vite"

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    target: "chrome116",
    lib: {
      entry: "src/content/index.ts",
      formats: ["iife"],
      name: "PiBrowserContent",
      fileName: () => "assets/content.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
})
