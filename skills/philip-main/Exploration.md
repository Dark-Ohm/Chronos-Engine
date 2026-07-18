# Codebase Exploration

Philip explores codebases to produce documentation, not to admire directory
trees.

## Principle

Start with docs and manifests, then follow public entry points outward. Exact
search comes before semantic search. Runtime checks or web research enter only
when local evidence is missing, version-sensitive, or dependency-specific.

## Exploration Depth

### Quick

Use when the user names a file, module, symbol, narrow change, or stale claim.

1. Read the named doc or code area.
2. Search exact symbols, commands, env vars, flags, and paths.
3. Check nearby tests, examples, package scripts, and docs links.
4. Write or report only what this evidence supports.

### Standard

Use for README, setup, API, architecture, rewrite, and whole-doc audits.

1. Read repo guidance and entry docs: `README*`, `AGENTS.md`, `CLAUDE.md`, `.cursor/rules/**`, `CONTRIBUTING*`.
2. Detect manifests and tooling: package, Python, Rust, Go, Docker, CI, Make, and task runners.
3. Find public surfaces: CLIs, routes, schemas, SDK exports, config files, migrations, generated specs.
4. Find tests and examples that prove behavior.
5. Build a claim-evidence map before writing.
6. Verify every command, env var, API, path, and public symbol mentioned in the output.

### Deep

Use for large repos, architecture guides, missing-doc audits, or confusing
systems.

1. Run the Standard pass.
2. Add git history: recent churn, renamed files, deleted commands, and PR/MR scope if available.
3. Trace data flow from entry point to handler, domain logic, storage, and external integrations.
4. Use semantic search or a read-only exploration subagent for broad discovery, then verify important claims locally.
5. Produce a reusable map: entry points, key types, data flow, config, tests, external dependencies, and doc gaps.

## Claim-Evidence Map

Before writing, record claims like this:

| Claim | Evidence | Status |
| --- | --- | --- |
| `pnpm test` verifies setup | `package.json` script, CI workflow | verified |
| `DATABASE_URL` is required | env schema or code read | verified |
| API returns `user.id` | route handler, schema, test | verified |
| Deploy uses Vercel | no repo evidence | unknown |

No published doc claim leaves this table as unknown unless the doc explicitly
says it is unknown.

## Optional Read-Only Exploration Prompt

Use only when the repo is large or the area is unclear:

```text
Explore this codebase in read-only mode for documentation work.

Return a concise map with:
1. Entry points: CLIs, routes, SDK exports, jobs, services
2. Public contracts: schemas, config, env vars, command flags, generated specs
3. Data flow: input -> handler -> domain logic -> persistence/output
4. Tests/examples that prove behavior
5. Existing docs and likely stale or missing docs
6. Files that need local verification before publication

Do not write docs. Return evidence with file paths and symbols.
```

Exploration subagents provide leads, not publishable truth. The parent agent
must locally verify high-impact claims before publication or label them with
the appropriate verification state, such as `not found` or `partially verified`.

## Web Research Boundary

Use web research only when the claim depends on external current behavior:
agent platform skill discovery, dependency APIs, hosted service limits, or
current CLI flags. Local repo behavior still wins.

Do not use web research to infer what a local project does. Local source,
tests, config, generated specs, command output, git history, and optional Orbit
context beat external docs. If web docs and source disagree, document the
source behavior and flag the external mismatch.
