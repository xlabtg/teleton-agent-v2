import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["packages/sdk/src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: "dist/packages/sdk",
  external: ["@teleton/core"],
});
