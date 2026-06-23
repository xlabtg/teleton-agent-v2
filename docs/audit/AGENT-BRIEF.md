# Audit issue-authoring brief

You are one of several reviewers turning a confirmed audit finding-list into
professional GitHub issue drafts for the Teleton Agent V2 repository. This is an
**authorized defensive review of the project's own codebase** (tracked in issue
#58). Your output is a JSON file consumed by `create-issues.mjs`.

## What to do

For **each** finding in the list you are given:

1. **Open the referenced file(s) and confirm the defect** by reading the real
   code. Use the exact current line numbers — do not trust the line numbers in
   the finding list blindly; re-derive them.
2. If, on inspection, the finding is **not** a real defect, do not invent one —
   set `"status": "rejected"` with a `"rejectionReason"` instead.
3. Write a professional issue `body` (see format below) including a **short,
   exact code excerpt** (5–15 lines, fenced with a language tag) and `path:line`
   references.
4. Emit all findings as a single JSON array to your assigned output file using
   the Write tool.

Return (as your final message) only a one-line-per-finding summary plus any
rejections or deviations — **not** the JSON itself.

## Finding object (see SCHEMA.md)

```json
{
  "slug": "<area-prefix>-<kebab-summary>",
  "title": "Concise, specific summary (no leading emoji, no severity word)",
  "severity": "critical | high | medium | low",
  "category": "security | bug | reliability | correctness | data-loss | resource-leak | performance | supply-chain | ci-cd | error-handling | type-safety | architecture | concurrency",
  "areas": ["<one or more component ids>"],
  "location": "path/to/file.ts:line-range",
  "body": "## Description ... ## Impact ... ## Required Fix ... ## References"
}
```

- `severity` and `category` are given to you per finding — keep them unless your
  reading shows they are clearly wrong (note any change in your summary).
- `areas` valid ids: `api`, `core`, `infra`, `memory`, `intelligence`, `agents`,
  `integrations`, `network`, `learning`, `ui`, `sdk`, `web`, `v1`, `docker`,
  `build`, `security`.
- `slug` must be globally unique; use the prefix you are assigned.

## Body format (match the repo's existing issues)

```markdown
## Description

<1–3 short paragraphs. Include a fenced code excerpt with the real lines and
`path:line` references.>

## Impact

<Concrete consequences and who/what is affected. Justify the severity.>

## Required Fix

1. <actionable step>
2. <actionable step>

## References

<For security findings, cite the relevant OWASP and/or CWE entries with links.
For non-security findings, link to related docs or omit this section if there is
nothing meaningful to cite.>
```

Rules:

- Be precise and verifiable. Quote real code; never fabricate line numbers or APIs.
- Keep each body focused on **one** defect. Only merge two list items into one
  issue if they are literally the same root cause at the same location.
- Do not propose fixes that remove existing features; propose the minimal correct fix.
- Write valid JSON (escape newlines/quotes inside `body`). Verify it parses.
