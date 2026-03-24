import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["packages/api/src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: "dist/packages/api",
  // Bundle workspace packages so the built output runs without workspace resolution.
  noExternal: ["@teleton/core", "@teleton/infrastructure"],
});
