import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["packages/integrations/src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: "dist/packages/integrations",
  external: ["@teleton/core"],
});
