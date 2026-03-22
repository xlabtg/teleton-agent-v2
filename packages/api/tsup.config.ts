import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["packages/api/src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: "dist/packages/api",
  external: ["@teleton/core", "@teleton/infrastructure"],
});
