import { defineConfig } from "vite"

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "chrome116",
    lib: {
      entry: "src/background/service-worker.ts",
      formats: ["es"],
      fileName: () => "assets/background.js",
    },
    rollupOptions: {
      output: {
        inlineDynamicImports: true,
      },
    },
  },
})
