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

/**
 * Render a GitHub-flavoured markdown table whose columns are padded to a
 * uniform width, matching `prettier --check` output so the generated report
 * stays lint-clean across regenerations. `headers` and each row in `rows` are
 * arrays of already-escaped cell strings; every column is left-aligned.
 */
function mdTable(headers, rows) {
  const width = headers.map((h, i) =>
    Math.max(3, h.length, ...rows.map((r) => r[i].length))
  );
  const fmt = (cells) => "| " + cells.map((c, i) => c.padEnd(width[i])).join(" | ") + " |";
  const sep = "| " + width.map((w) => "-".repeat(w)).join(" | ") + " |";
  return [fmt(headers), sep, ...rows.map(fmt)];
}

/**
 * Escape markdown inline-significant characters in a free-text table cell so
 * the text renders literally (e.g. `_field` and `*.pem` stay verbatim instead
 * of being parsed as emphasis) and the output is stable under `prettier
 * --check`. Underscores are escaped only at word boundaries — CommonMark (and
 * prettier) never treat an intra-word `_` such as `GITHUB_TOKEN` as emphasis,
 * so escaping those would diverge from `prettier --check`. Do not apply to
 * cells that are intentional code spans or links.
 */
const isAlnum = (ch) => ch !== undefined && /[A-Za-z0-9]/.test(ch);
function esc(value) {
  const s = String(value ?? "");
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === "\\" || c === "`" || c === "|" || c === "*") {
      out += "\\" + c; // always emphasis/table-significant
    } else if (c === "_" && (!isAlnum(s[i - 1]) || !isAlnum(s[i + 1]))) {
      out += "\\_"; // underscore only at a word boundary
    } else {
      out += c;
    }
  }
  return out;
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
const STAGE = {
  critical: "Stage 1 — Critical: Security & Data Integrity",
  high: "Stage 2 — High: Correctness & Reliability",
  medium: "Stage 3 — Medium: Hardening & Robustness",
  low: "Stage 4 — Low: Tech Debt & Polish",
};
mdTable(
  ["Severity", "Count", "Implementation stage"],
  sevCounts.map(([s, n]) => [`${SEV_EMOJI[s]} ${s.toUpperCase()}`, String(n), STAGE[s]])
).forEach(L);
L();
L("### By category");
L();
mdTable(
  ["Category", "Count"],
  tally(confirmed, "category").map(([c, n]) => ["`" + c + "`", String(n)])
).forEach(L);
L();
L("### By component");
L();
mdTable(
  ["Component", "Count"],
  tally(confirmed, "areas").map(([a, n]) => ["`area:" + a + "`", String(n)])
).forEach(L);
L();

for (const sev of SEV_ORDER) {
  const group = confirmed.filter((f) => f.severity === sev);
  if (!group.length) continue;
  L(`## ${SEV_EMOJI[sev]} ${sev.toUpperCase()} (${group.length})`);
  L();
  const rows = group.map((f, i) => {
    const m = manifest[f.slug];
    return [
      String(i + 1),
      esc(f.title),
      "`" + f.category + "`",
      f.areas.map((a) => "`" + a + "`").join(" "),
      "`" + f.location + "`",
      m ? `[#${m.number}](${m.url})` : "—",
    ];
  });
  mdTable(["#", "Title", "Category", "Component", "Location", "Issue"], rows).forEach(L);
  L();
}

if (rejected.length) {
  L("## Rejected / verified-safe");
  L();
  L("Suspected issues that were investigated and found **not** to be defects.");
  L();
  const rows = rejected.map((f) => [
    esc(f.title),
    f.areas.map((a) => "`" + a + "`").join(" "),
    esc(f.rejectionReason),
  ]);
  mdTable(["Title", "Component", "Reason"], rows).forEach(L);
  L();
}

writeFileSync(OUT, lines.join("\n").trimEnd() + "\n");
console.log(`Wrote ${OUT} — ${confirmed.length} confirmed, ${rejected.length} rejected.`);
