# Audit finding schema

Each file under `docs/audit/findings/*.json` is a JSON **array** of finding
objects. Both `generate-report.mjs` and `create-issues.mjs` consume this format.

## Finding object

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `slug` | string | yes | Globally unique, kebab-case, area-prefixed (e.g. `api-rbac-fail-open`). Stable identifier used for dedup and cross-references. |
| `title` | string | yes | Concise, specific summary. Becomes the GitHub issue title prefixed with a severity emoji + label. |
| `severity` | `"critical" \| "high" \| "medium" \| "low"` | yes | Drives the emoji, the severity label, and the implementation stage (milestone). |
| `category` | enum | yes | Primary defect class — applied as a label. One of: `security`, `bug`, `reliability`, `correctness`, `data-loss`, `resource-leak`, `performance`, `supply-chain`, `ci-cd`, `error-handling`, `type-safety`, `architecture`, `concurrency`. |
| `areas` | string[] | yes | One or more components. Each becomes an `area:<x>` label. One of: `api`, `core`, `infra`, `memory`, `intelligence`, `agents`, `integrations`, `network`, `learning`, `ui`, `sdk`, `web`, `v1`, `docker`, `build`, `security`. |
| `location` | string | yes | Primary `path:line` (or `path:line-range`) of the defect. |
| `body` | string | yes | Full GitHub-flavored-markdown issue body. Must contain the sections below. |
| `status` | `"confirmed" \| "rejected"` | no | Defaults to `confirmed`. `rejected` findings are documented in the report but **not** filed as issues. |
| `rejectionReason` | string | when `status==="rejected"` | Why the suspected issue is not a real defect. |

## Severity → stage (milestone) mapping

| Severity | Emoji | Milestone |
|----------|-------|-----------|
| critical | 🔴 | Stage 1: Critical — Security & Data Integrity |
| high | 🟠 | Stage 2: High — Correctness & Reliability |
| medium | 🟡 | Stage 3: Medium — Hardening & Robustness |
| low | 🟢 | Stage 4: Low — Tech Debt & Polish |

Every filed issue also carries the `audit` label.

## Required body sections

The `body` markdown must follow the repository's established issue format:

```markdown
## Description

<what the defect is, with a short exact code excerpt and `path:line` refs>

## Impact

<concrete consequences: what breaks, who is affected, severity rationale>

## Required Fix

<numbered, actionable remediation steps>

## References

<OWASP / CWE links for security findings; relevant docs otherwise>
```
