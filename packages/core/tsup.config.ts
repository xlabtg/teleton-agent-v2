import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["packages/core/src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: "dist/packages/core",
});
