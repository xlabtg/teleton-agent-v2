import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["packages/network/src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: "dist/packages/network",
  external: ["@teleton/core"],
});
