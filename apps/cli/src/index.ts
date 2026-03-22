#!/usr/bin/env node
/**
 * Teleton Agent V2 — CLI Interface.
 */

import { Command } from "commander";
import { TeletonApp } from "../../agent/src/index.js";

const program = new Command();

program
  .name("teleton")
  .description("Teleton V2: Autonomous AI Agent for Telegram & TON Blockchain")
  .version("2.0.0-alpha.1");

program
  .command("start")
  .description("Start the Teleton agent")
  .option("-c, --config <path>", "Path to configuration file")
  .action(async (options) => {
    const app = new TeletonApp();
    await app.start(options.config);
  });

program
  .command("doctor")
  .description("Check system requirements and configuration")
  .action(async () => {
    console.log("🔍 Running system diagnostics...\n");

    // Check Node.js version
    const nodeVersion = process.versions.node;
    const major = parseInt(nodeVersion.split(".")[0], 10);
    console.log(`  Node.js: v${nodeVersion} ${major >= 20 ? "✅" : "❌ (requires >= 20)"}`);

    // Check environment variables
    const envVars = ["TELETON_TELEGRAM_API_ID", "TELETON_TELEGRAM_API_HASH", "TELETON_LLM_API_KEY"];
    for (const v of envVars) {
      console.log(`  ${v}: ${process.env[v] ? "✅ set" : "⚠️  not set"}`);
    }

    console.log("\n✅ Diagnostics complete");
  });

program
  .command("config")
  .description("Show current configuration")
  .option("-c, --config <path>", "Path to configuration file")
  .action(async (options) => {
    console.log("📋 Configuration:");
    console.log(`  Config path: ${options.config ?? "~/.teleton-v2/config.yaml"}`);
    // TODO: Load and display parsed config (with secrets masked)
  });

program.parse();
