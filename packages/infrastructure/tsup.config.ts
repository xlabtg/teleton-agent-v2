import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["packages/infrastructure/src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: "dist/packages/infrastructure",
  external: ["@teleton/core"],
});
