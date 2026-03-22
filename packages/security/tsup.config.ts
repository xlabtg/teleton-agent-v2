import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["packages/security/src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: "dist/packages/security",
  external: ["@teleton/core"],
});
