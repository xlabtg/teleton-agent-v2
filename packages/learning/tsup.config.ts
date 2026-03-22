import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["packages/learning/src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: "dist/packages/learning",
  external: ["@teleton/core"],
});
