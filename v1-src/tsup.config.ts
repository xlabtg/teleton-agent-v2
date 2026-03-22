import { defineConfig } from "tsup";
import { rmSync, readdirSync } from "node:fs";
import { join } from "node:path";
import pkg from "../package.json" with { type: "json" };

// Bundle everything EXCEPT production dependencies and Node builtins.
// This ensures @ston-fi/* (devDeps with pnpm-only install blocker)
// and all their transitive deps are inlined into dist/.
const external = [
  ...Object.keys(pkg.dependencies ?? {}),
  ...Object.keys((pkg as Record<string, unknown>).optionalDependencies as Record<string, string> ?? {}),
];

// Clean dist/ but preserve dist/web/ and dist/apps/ (V2 builds)
function cleanDistPreserveProtected() {
  const preserve = new Set(["web", "apps"]);
  try {
    for (const entry of readdirSync("dist")) {
      if (preserve.has(entry)) continue;
      rmSync(join("dist", entry), { recursive: true, force: true });
    }
  } catch {
    // dist/ doesn't exist yet — nothing to clean
  }
}

cleanDistPreserveProtected();

export default defineConfig({
  entry: {
    index: "v1-src/index.ts",
    "cli/index": "v1-src/cli/index.ts",
  },
  format: "esm",
  target: "node20",
  platform: "node",
  splitting: true,
  clean: false,
  dts: false,
  sourcemap: false,
  outDir: "dist",
  external,
});
