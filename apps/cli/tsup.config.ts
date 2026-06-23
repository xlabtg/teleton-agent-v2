import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["apps/cli/src/index.ts"],
  format: ["esm"],
  target: "node20",
  platform: "node",
  sourcemap: true,
  clean: true,
  outDir: "dist/apps/cli",
  // Bundle workspace packages so the built CLI works after the V2 runtime build.
  noExternal: ["@teleton/core", "@teleton/infrastructure", "@teleton/api", "@teleton/sdk"],
});
