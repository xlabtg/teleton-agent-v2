import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@teleton/core": resolve(__dirname, "packages/core/src"),
      "@teleton/infrastructure": resolve(__dirname, "packages/infrastructure/src"),
      "@teleton/api": resolve(__dirname, "packages/api/src"),
      "@teleton/sdk": resolve(__dirname, "packages/sdk/src"),
      "@teleton/intelligence": resolve(__dirname, "packages/intelligence/src"),
      "@teleton/integrations": resolve(__dirname, "packages/integrations/src"),
      "@teleton/security": resolve(__dirname, "packages/security/src"),
      "@teleton/ui": resolve(__dirname, "packages/ui/src"),
      "@teleton/network": resolve(__dirname, "packages/network/src"),
    },
  },
  test: {
    globals: true,
    include: ["__tests__/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["packages/*/src/**/*.ts"],
      exclude: ["**/index.ts", "**/*.d.ts"],
    },
    testTimeout: 10000,
  },
});
