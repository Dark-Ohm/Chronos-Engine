# Audit Workflow

Use this workflow when the user asks what is wrong with the docs, requests a documentation health check, or wants gaps ranked by severity.

Load with `../Audit.md`, `../DocTypes.md`, `../Exploration.md`, and `../OrbitIntegration.md` if Orbit is available.

## 0. Scope

Clarify only when scope changes the work:

- Whole repo audit.
- Specific area: setup, API, architecture, runbooks, README.
- Specific audience: new contributor, operator, customer, maintainer.
- Specific base branch or PR range.

If the user says "audit docs" with no scope, audit the whole documentation surface.

## 1. Explore Project Shape

Use Standard exploration from `../Exploration.md` by default. Escalate to Deep
exploration for whole-repo audits, architecture-heavy audits, large repos, or
systems where public surfaces are unclear.

Identify languages, frameworks, interfaces, and operational surfaces:

```bash
git status --short --branch
rg --files -g 'package.json' -g 'pnpm-lock.yaml' -g 'yarn.lock' -g 'package-lock.json'
rg --files -g 'pyproject.toml' -g 'requirements*.txt' -g 'poetry.lock'
rg --files -g 'Cargo.toml' -g 'Cargo.lock' -g 'go.mod' -g 'go.sum'
rg --files -g 'Dockerfile*' -g 'docker-compose*.yml' -g '.github/workflows/**' -g '.gitlab-ci.yml'
rg --files -g '*openapi*' -g '*swagger*' -g 'proto/**' -g 'graphql/**'
```

If Orbit is available, run an aggregation for public symbols, file ownership, and undocumented hotspots before reading deeply.

## 2. Inventory Documentation

Build a coverage map:

```bash
rg --files -g '*.md' -g '*.mdx' -g 'README*' -g 'docs/**' -g 'CHANGELOG*' -g 'CONTRIBUTING*' -g 'SECURITY*'
rg -n "^#|TODO|FIXME|deprecated|DEPRECATED|coming soon|TBD|WIP|not implemented" README* docs *.md
rg -n "npm run|pnpm|yarn|cargo|go test|pytest|docker compose|make |curl |kubectl|terraform" README* docs *.md
rg -n "localhost|127\.0\.0\.1|PORT|TOKEN|SECRET|DATABASE_URL|API_KEY|GITLAB_TOKEN" README* docs *.md
```

For each doc, record:

- Purpose.
- Audience.
- Claimed workflows.
- Commands, env vars, paths, APIs, and screenshots mentioned.
- Last relevant doc changes from git.

## 3. Cross-Reference Claims

Verify claims against code. Use exact searches first, then semantic reading.

### Commands

```bash
rg -n '"scripts"|"bin"|"exports"' package.json
rg -n "Makefile|justfile|Taskfile|\.github/workflows|\.gitlab-ci" .
rg -n "program\.command|Command::new|argparse|click\.|cobra\.Command|commander|clap::" .
```

Check every documented command against package scripts, CLI parser code, Make targets, task runners, or CI.

### Environment And Config

```bash
rg -n "process\.env|import\.meta\.env|os\.getenv|std::env|ENV\[|dotenv|config\." .
rg -n "zod|joi|pydantic|envconfig|convict|dotenvy|configschema|serde" .
```

Confirm docs list required variables, defaults, and verification steps.

### APIs And Schemas

```bash
rg -n "router\.|app\.(get|post|put|patch|delete)|FastAPI|APIView|Controller|Route|graphql|Query|Mutation" .
rg --files -g '*openapi*' -g '*swagger*' -g 'proto/**' -g 'graphql/**' -g '*schema*'
```

Compare documented endpoints, request fields, response fields, auth, and errors.

### Architecture

```bash
rg -n "import |from .* import|require\(|use .*::|mod |package " src app lib crates packages
rg --files -g 'src/**' -g 'app/**' -g 'lib/**' -g 'packages/**' -g 'crates/**'
```

Look for undocumented service boundaries, queues, databases, external APIs, auth layers, generated code, and deployment assumptions.

### Security And Destructive Operations

```bash
rg -n "auth|authorize|permission|role|token|secret|password|encrypt|decrypt|keychain|vault|delete|drop|truncate|destroy|force" .
```

Flag docs that omit warnings for credentials, production data, or destructive commands.

## 4. Check Freshness

Use git to find code that changed without docs:

```bash
git log --since='90 days ago' --name-status --oneline
git log --name-only --pretty=format:'%h %s' -- README.md docs '*.md' '*.mdx'
git diff --name-only origin/main...HEAD
```

If no base branch exists, use:

```bash
git branch --all --verbose
git merge-base --fork-point @{upstream} HEAD
```

Then compare recent source changes to documentation changes. A hot code area with no docs is a gap, not automatically a bug. Rank by user impact.

## 5. Optional Runtime Verification

Run only safe commands and respect repo norms:

```bash
pnpm --version
npm run
cargo test --no-run
go test ./...
pytest --collect-only
```

Do not run migrations, deploys, destructive scripts, or production commands unless the user explicitly asks and the risk is clear.

## 6. Produce Report

Write a severity-ranked audit:

```markdown
# Documentation Audit

## Executive Summary
[Health, top risks, likely effort.]

## Findings
### Critical
- [Title]
  - Problem: [What is wrong.]
  - Evidence: `path`, symbol, command output, git commit, or Orbit node.
  - Impact: [Specific user harm.]
  - Fix: [Specific doc change.]
  - Verification: [verified | not run | not found | partially verified] - [What was checked.]
  - Confidence: [High | Medium | Low.]

### High
...

### Medium
...

### Low
...

## Coverage Map
| Area | Docs | Code Evidence | Status |

## Recommended Plan
1. [First fix.]
2. [Second fix.]

## Unknowns
- [What was not verified.]

## Verification Notes
- [Commands run, files checked, or checks intentionally not run.]
- [Orbit used, Orbit unavailable, or Orbit intentionally not checked.]
```

Make the report useful enough that another agent can implement the fixes without rediscovering the repo.

If the user asks for a plan artifact instead of a plain report, preserve the Philip audit sections first: Executive Summary, Findings, Coverage Map, Recommended Plan, Unknowns, and Verification Notes. Put implementation checklists, todos, owner assignments, or task graphs after those sections.

## 7. Lint, Revise, Rerun

Run the bundled audit structure validator before publishing the report:

```bash
node scripts/audit-report-lint.mjs path/to/audit.md
```

For installed-skill contexts, use the copied script from the Philip skill directory:

```bash
node ~/.agents/skills/philip/scripts/audit-report-lint.mjs path/to/audit.md
```

For stdin-based drafting:

```bash
node scripts/audit-report-lint.mjs --format audit -
```

For plan artifacts:

```bash
node scripts/audit-report-lint.mjs --format plan path/to/plan.md
```

Loop until structural errors are gone:

1. Draft from evidence.
2. Run the linter.
3. Revise the report from actionable feedback.
4. Rerun the linter.
5. Publish only after remaining failures are either fixed or explicitly disclosed.

Validation feedback is a drafting aid. It is not permission to invent evidence, upgrade confidence, remove unknowns, or suppress uncertainty. If the linter exposes a missing section and the evidence is unavailable, add the section and state the unknown plainly.

## 8. Quality Check

Before handing off:

- Every finding has evidence.
- Every finding includes Problem, Evidence, Impact, Fix, Verification, and Confidence.
- Verification labels are `verified`, `not run`, `not found`, or `partially verified`.
- The Coverage Map is honest about whole-repo versus sampled scope.
- Severity is based on user harm.
- Recommendations name target docs or sections.
- Orbit use or fallback is disclosed.
- `node scripts/audit-report-lint.mjs path/to/audit.md` passes, or structural failures are disclosed.
- No filler phrases from `../Writing.md` remain.
