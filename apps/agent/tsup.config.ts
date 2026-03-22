import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["apps/agent/src/index.ts"],
  format: ["esm"],
  sourcemap: true,
  clean: true,
  outDir: "dist/apps/agent",
  external: ["@teleton/core", "@teleton/infrastructure", "@teleton/api", "@teleton/sdk"],
});
