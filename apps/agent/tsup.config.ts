import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["apps/agent/src/index.ts"],
  format: ["esm"],
  sourcemap: true,
  clean: true,
  outDir: "dist/apps/agent",
  // Bundle workspace packages so the built output runs without workspace resolution.
  // Only keep truly external native dependencies that cannot be bundled.
  noExternal: ["@teleton/core", "@teleton/infrastructure", "@teleton/api", "@teleton/sdk"],
});
