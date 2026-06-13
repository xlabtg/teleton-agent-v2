#!/usr/bin/env node
/**
 * create-issues.mjs — file the audit findings as professional GitHub issues.
 *
 * Reads every `docs/audit/findings/*.json` array, validates each finding
 * against the schema in SCHEMA.md, and creates one GitHub issue per
 * confirmed finding with the appropriate severity label, category label,
 * `area:*` component labels, the `audit` label, and the stage milestone.
 *
 * The script is idempotent: it skips any finding whose computed issue title
 * already exists in the repository (open or closed), so re-runs only create
 * what is missing. A slug → {number,url} manifest is written to
 * `created-issues.json` for the report generator to render links.
 *
 * Usage:
 *   node docs/audit/create-issues.mjs            # create missing issues
 *   DRY_RUN=1 node docs/audit/create-issues.mjs  # validate + preview only
 */

import { readFileSync, readdirSync, writeFileSync, existsSync, mkdtempSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = process.env.AUDIT_REPO ?? "xlabtg/teleton-agent-v2";
const DRY = process.env.DRY_RUN === "1";
const FINDINGS_DIR = join(__dirname, "findings");
const MANIFEST = join(__dirname, "created-issues.json");

const SEVERITY = {
  critical: { emoji: "🔴", milestone: "Stage 1: Critical — Security & Data Integrity" },
  high: { emoji: "🟠", milestone: "Stage 2: High — Correctness & Reliability" },
  medium: { emoji: "🟡", milestone: "Stage 3: Medium — Hardening & Robustness" },
  low: { emoji: "🟢", milestone: "Stage 4: Low — Tech Debt & Polish" },
};
const CATEGORIES = new Set([
  "security", "bug", "reliability", "correctness", "data-loss", "resource-leak",
  "performance", "supply-chain", "ci-cd", "error-handling", "type-safety",
  "architecture", "concurrency", "documentation",
]);
const AREAS = new Set([
  "api", "core", "infra", "memory", "intelligence", "agents", "integrations",
  "network", "learning", "ui", "sdk", "web", "v1", "docker", "build", "security",
]);

/** Block synchronously for `ms` milliseconds (rate-limit friendliness). */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function loadFindings() {
  if (!existsSync(FINDINGS_DIR)) {
    console.error(`findings dir not found: ${FINDINGS_DIR}`);
    process.exit(1);
  }
  const files = readdirSync(FINDINGS_DIR).filter((f) => f.endsWith(".json")).sort();
  const all = [];
  for (const f of files) {
    let arr;
    try {
      arr = JSON.parse(readFileSync(join(FINDINGS_DIR, f), "utf8"));
    } catch (e) {
      console.error(`✗ ${f}: invalid JSON — ${e.message}`);
      process.exit(1);
    }
    if (!Array.isArray(arr)) {
      console.error(`✗ ${f}: top-level value must be an array`);
      process.exit(1);
    }
    for (const x of arr) {
      x._file = f;
      all.push(x);
    }
  }
  return all;
}

function validate(findings) {
  const errors = [];
  const slugs = new Set();
  for (const f of findings) {
    const where = `${f._file} :: ${f.slug ?? f.title ?? "<unnamed>"}`;
    if (!f.slug) errors.push(`${where}: missing slug`);
    else if (slugs.has(f.slug)) errors.push(`${where}: duplicate slug "${f.slug}"`);
    else slugs.add(f.slug);
    if (!f.title) errors.push(`${where}: missing title`);
    if (!SEVERITY[f.severity]) errors.push(`${where}: bad severity "${f.severity}"`);
    if (!CATEGORIES.has(f.category)) errors.push(`${where}: bad category "${f.category}"`);
    if (!Array.isArray(f.areas) || f.areas.length === 0)
      errors.push(`${where}: areas must be a non-empty array`);
    else
      for (const a of f.areas)
        if (!AREAS.has(a)) errors.push(`${where}: unknown area "${a}"`);
    if (!f.location) errors.push(`${where}: missing location`);
    if (!f.body || f.body.trim().length < 40) errors.push(`${where}: body too short / missing`);
    if (f.status && !["confirmed", "rejected"].includes(f.status))
      errors.push(`${where}: bad status "${f.status}"`);
    if (f.status === "rejected" && !f.rejectionReason)
      errors.push(`${where}: rejected finding needs rejectionReason`);
  }
  return errors;
}

const ghTitle = (f) => `${SEVERITY[f.severity].emoji} ${f.severity.toUpperCase()}: ${f.title}`;
const labelsFor = (f) => [
  f.severity,
  f.category,
  ...f.areas.map((a) => `area:${a}`),
  "audit",
];

function existingTitles() {
  const out = execFileSync(
    "gh",
    ["issue", "list", "--repo", REPO, "--state", "all", "--limit", "1000", "--json", "title"],
    { encoding: "utf8" }
  );
  return new Set(JSON.parse(out).map((i) => i.title));
}

function createIssue(f) {
  const title = ghTitle(f);
  const labels = labelsFor(f);
  const milestone = SEVERITY[f.severity].milestone;
  const dir = mkdtempSync(join(tmpdir(), "audit-"));
  const bodyFile = join(dir, "body.md");
  // Embed a stable marker so the finding is traceable back to its slug.
  writeFileSync(bodyFile, `${f.body}\n\n<!-- audit-slug: ${f.slug} -->\n`);
  const args = [
    "issue", "create", "--repo", REPO,
    "--title", title,
    "--body-file", bodyFile,
    "--milestone", milestone,
  ];
  for (const l of labels) args.push("--label", l);
  const url = execFileSync("gh", args, { encoding: "utf8" }).trim();
  const number = Number(url.split("/").pop());
  return { url, number };
}

// ── main ──────────────────────────────────────────────────────────────────
const findings = loadFindings();
const errors = validate(findings);
if (errors.length) {
  console.error(`Validation failed (${errors.length}):`);
  for (const e of errors) console.error("  - " + e);
  process.exit(1);
}

const confirmed = findings.filter((f) => f.status !== "rejected");
const rejected = findings.filter((f) => f.status === "rejected");
const bySev = (s) => confirmed.filter((f) => f.severity === s).length;
console.log(
  `Loaded ${findings.length} findings: ${confirmed.length} confirmed ` +
    `(🔴${bySev("critical")} 🟠${bySev("high")} 🟡${bySev("medium")} 🟢${bySev("low")}), ` +
    `${rejected.length} rejected.`
);

const existing = DRY ? new Set() : existingTitles();
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};
let created = 0,
  skipped = 0,
  failed = 0;

for (const f of confirmed) {
  const title = ghTitle(f);
  if (existing.has(title) || manifest[f.slug]) {
    skipped++;
    continue;
  }
  if (DRY) {
    console.log(`[dry] would create: ${title}  {${labelsFor(f).join(", ")}}`);
    created++;
    continue;
  }
  let attempt = 0;
  for (;;) {
    try {
      const { url, number } = createIssue(f);
      manifest[f.slug] = { number, url, title };
      writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + "\n");
      console.log(`✓ #${number} ${title}`);
      created++;
      break;
    } catch (e) {
      attempt++;
      if (attempt >= 4) {
        console.error(`✗ failed: ${title} — ${e.message}`);
        failed++;
        break;
      }
      const backoff = 3000 * attempt;
      console.error(`  retry ${attempt} after ${backoff}ms (${e.message?.split("\n")[0]})`);
      sleep(backoff);
    }
  }
  sleep(2000); // stay under GitHub content-creation secondary rate limits
}

console.log(`\nDone. created=${created} skipped=${skipped} failed=${failed}`);
if (failed) process.exit(1);
