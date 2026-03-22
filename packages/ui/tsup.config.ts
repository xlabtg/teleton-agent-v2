import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["packages/ui/src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: "dist/packages/ui",
  external: ["@teleton/core"],
});
