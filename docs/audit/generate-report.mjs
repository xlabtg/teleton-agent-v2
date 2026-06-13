#!/usr/bin/env node
/**
 * generate-report.mjs — render AUDIT-REPORT.md from the findings dataset.
 *
 * Aggregates every `docs/audit/findings/*.json` array into a single human
 * report: severity/category/area roll-ups plus a full findings table. If
 * `created-issues.json` exists (written by create-issues.mjs), each row links
 * to its filed GitHub issue.
 *
 * Usage: node docs/audit/generate-report.mjs
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = process.env.AUDIT_REPO ?? "xlabtg/teleton-agent-v2";
const FINDINGS_DIR = join(__dirname, "findings");
const MANIFEST = join(__dirname, "created-issues.json");
const OUT = join(__dirname, "AUDIT-REPORT.md");

const SEV_ORDER = ["critical", "high", "medium", "low"];
const SEV_EMOJI = { critical: "🔴", high: "🟠", medium: "🟡", low: "🟢" };

function loadFindings() {
  const files = readdirSync(FINDINGS_DIR).filter((f) => f.endsWith(".json")).sort();
  const all = [];
  for (const f of files) {
    const arr = JSON.parse(readFileSync(join(FINDINGS_DIR, f), "utf8"));
    for (const x of arr) all.push(x);
  }
  return all;
}

function tally(items, key) {
  const m = new Map();
  for (const it of items) {
    const vals = Array.isArray(it[key]) ? it[key] : [it[key]];
    for (const v of vals) m.set(v, (m.get(v) ?? 0) + 1);
  }
  return [...m.entries()].sort((a, b) => b[1] - a[1]);
}

const findings = loadFindings();
const confirmed = findings.filter((f) => f.status !== "rejected");
const rejected = findings.filter((f) => f.status === "rejected");
const manifest = existsSync(MANIFEST) ? JSON.parse(readFileSync(MANIFEST, "utf8")) : {};

confirmed.sort((a, b) => {
  const s = SEV_ORDER.indexOf(a.severity) - SEV_ORDER.indexOf(b.severity);
  if (s !== 0) return s;
  return (a.areas[0] ?? "").localeCompare(b.areas[0] ?? "");
});

const sevCounts = SEV_ORDER.map((s) => [s, confirmed.filter((f) => f.severity === s).length]);
const lines = [];
const L = (s = "") => lines.push(s);

L("# Teleton Agent V2 — Full Codebase Audit Report");
L();
L(`> Generated from \`docs/audit/findings/*.json\` by \`generate-report.mjs\`.`);
L(`> Audit tracked in issue [#58](https://github.com/${REPO}/issues/58).`);
L();
L("## Scope & Methodology");
L();
L(
  "This report is the result of a full, subsystem-by-subsystem review of the " +
    "Teleton Agent V2 monorepo: every workspace package (`core`, `infrastructure`, " +
    "`api`, `agents`, `memory`, `intelligence`, `integrations`, `security`, `network`, " +
    "`learning`, `ui`, `sdk`), the `apps/` entrypoints, the V1 source tree (`v1-src/`), " +
    "the React `web/` frontend, and the CI/CD, Docker and packaging configuration."
);
L();
L(
  "Each finding was confirmed by reading the referenced source. Suspected issues " +
    "that turned out to be safe on inspection are listed under **Rejected / verified-safe** " +
    "rather than filed, to document the verification."
);
L();
L("Each filed issue carries: a **severity** label, a **category** label, one or more " +
  "**`area:*`** component labels, the **`audit`** label, and a **stage milestone**.");
L();
L("## Summary");
L();
L(`- **Total confirmed findings:** ${confirmed.length}`);
L(`- **Rejected / verified-safe:** ${rejected.length}`);
L();
L("### By severity → stage");
L();
L("| Severity | Count | Implementation stage |");
L("|----------|-------|-----------------------|");
const STAGE = {
  critical: "Stage 1 — Critical: Security & Data Integrity",
  high: "Stage 2 — High: Correctness & Reliability",
  medium: "Stage 3 — Medium: Hardening & Robustness",
  low: "Stage 4 — Low: Tech Debt & Polish",
};
for (const [s, n] of sevCounts) L(`| ${SEV_EMOJI[s]} ${s.toUpperCase()} | ${n} | ${STAGE[s]} |`);
L();
L("### By category");
L();
L("| Category | Count |");
L("|----------|-------|");
for (const [c, n] of tally(confirmed, "category")) L(`| \`${c}\` | ${n} |`);
L();
L("### By component");
L();
L("| Component | Count |");
L("|-----------|-------|");
for (const [a, n] of tally(confirmed, "areas")) L(`| \`area:${a}\` | ${n} |`);
L();

for (const sev of SEV_ORDER) {
  const group = confirmed.filter((f) => f.severity === sev);
  if (!group.length) continue;
  L(`## ${SEV_EMOJI[sev]} ${sev.toUpperCase()} (${group.length})`);
  L();
  L("| # | Title | Category | Component | Location | Issue |");
  L("|---|-------|----------|-----------|----------|-------|");
  group.forEach((f, i) => {
    const m = manifest[f.slug];
    const link = m ? `[#${m.number}](${m.url})` : "—";
    const loc = "`" + f.location + "`";
    L(`| ${i + 1} | ${f.title.replace(/\|/g, "\\|")} | \`${f.category}\` | ${f.areas.map((a) => "`" + a + "`").join(" ")} | ${loc} | ${link} |`);
  });
  L();
}

if (rejected.length) {
  L("## Rejected / verified-safe");
  L();
  L("Suspected issues that were investigated and found **not** to be defects.");
  L();
  L("| Title | Component | Reason |");
  L("|-------|-----------|--------|");
  for (const f of rejected)
    L(`| ${f.title.replace(/\|/g, "\\|")} | ${f.areas.map((a) => "`" + a + "`").join(" ")} | ${(f.rejectionReason ?? "").replace(/\|/g, "\\|")} |`);
  L();
}

writeFileSync(OUT, lines.join("\n") + "\n");
console.log(`Wrote ${OUT} — ${confirmed.length} confirmed, ${rejected.length} rejected.`);
