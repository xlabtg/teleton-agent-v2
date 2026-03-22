import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["packages/agents/src/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  outDir: "dist/packages/agents",
  external: ["@teleton/core"],
});
