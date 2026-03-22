import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["packages/intelligence/src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: "dist/packages/intelligence",
  external: ["@teleton/core"],
});
