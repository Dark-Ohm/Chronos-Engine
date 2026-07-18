# GitLab Orbit Integration

Philip works without Orbit. Use Orbit only when the user's project already has GitLab Orbit or GitLab Knowledge Graph context available.

Orbit exposes graph-backed project knowledge through GitLab's API. Philip uses it for file ownership, cross-file dependencies, merge request history, undocumented hotspots, security context, and narrative summaries for complex areas.

## Boundaries

- Do not set up Orbit.
- Do not ask the user to create GitLab tokens.
- Do not change GitLab feature flags, project settings, or indexing configuration.
- Do not block documentation work when Orbit is unavailable.
- Treat Orbit as read-only supporting evidence. Local repo evidence remains the default.

## Detection

At the start of a workflow, only check whether Orbit context is already present.
If the environment does not already contain the required URL/token context, skip
Orbit entirely and continue with `rg`, filesystem search, and git history.

```bash
printenv GITLAB_TOKEN >/dev/null || printenv PRIVATE_TOKEN >/dev/null || echo "Orbit unavailable; use local evidence."
```

If a token is already present, a status check can confirm availability:

```bash
curl --fail --silent \
  --header "PRIVATE-TOKEN: ${GITLAB_TOKEN:-$PRIVATE_TOKEN}" \
  "${GITLAB_URL:-https://gitlab.com}/api/v4/orbit/status"
```

If status fails because the endpoint is missing, token is absent, or the project is not indexed, fall back to local evidence. Do not retry or turn the workflow into Orbit setup.

## Query Endpoint

When Orbit is already available, graph queries go to:

```bash
curl --fail --silent \
  --header "PRIVATE-TOKEN: ${GITLAB_TOKEN:-$PRIVATE_TOKEN}" \
  --header "Content-Type: application/json" \
  --data @query.json \
  "${GITLAB_URL:-https://gitlab.com}/api/v4/orbit/query"
```

Use `response_format: "llm"` when the result will feed a narrative section, audit summary, or architecture explanation. Use structured formats when building tables or evidence maps.

## Source Code Domain

Philip primarily queries the `source_code` domain:

- `File`: repository files, paths, ownership, churn, language, and doc linkage.
- `Definition`: functions, classes, modules, endpoints, commands, schemas, and exported symbols.
- `ImportedSymbol`: dependency edges between files and definitions.

Use Orbit nodes as evidence in audit findings and written docs. Include enough context that a reader can find the source file without Orbit.

## Query Types

### Search

Find files, definitions, commands, or docs by name and semantic context.

```json
{
  "project_id": "$PROJECT_ID",
  "query_type": "search",
  "domain": "source_code",
  "query": "CLI command for project initialization",
  "node_types": ["Definition", "File"],
  "limit": 20,
  "response_format": "llm"
}
```

Use for:

- Finding the source behind a doc claim.
- Locating public entry points.
- Discovering docs that mention stale commands.

### Traversal

Walk dependencies from a file or symbol.

```json
{
  "project_id": "$PROJECT_ID",
  "query_type": "traversal",
  "domain": "source_code",
  "start": {
    "type": "File",
    "path": "src/cli.ts"
  },
  "edges": ["imports", "defines", "calls"],
  "depth": 2,
  "response_format": "llm"
}
```

Use for:

- Architecture explanations.
- Finding config or auth dependencies.
- Understanding the blast radius of a documented workflow.

### Aggregation

Summarize hotspots across the project.

```json
{
  "project_id": "$PROJECT_ID",
  "query_type": "aggregation",
  "domain": "source_code",
  "group_by": ["owner", "language", "doc_coverage"],
  "metrics": ["file_count", "definition_count", "recent_mr_count", "undocumented_public_symbols"],
  "filters": {
    "visibility": "public"
  },
  "response_format": "llm"
}
```

Use for:

- Documentation health audits.
- Ownership maps.
- Identifying undocumented hotspots.

### Neighbors

Inspect the local graph around a node.

```json
{
  "project_id": "$PROJECT_ID",
  "query_type": "neighbors",
  "domain": "source_code",
  "node": {
    "type": "Definition",
    "name": "createProject"
  },
  "edge_types": ["defined_in", "referenced_by", "imports", "tested_by", "documented_by"],
  "limit": 50,
  "response_format": "llm"
}
```

Use for:

- Checking if a public symbol is documented.
- Finding tests for examples.
- Connecting docs to implementation.

### Path Finding

Find how two concepts connect.

```json
{
  "project_id": "$PROJECT_ID",
  "query_type": "path_finding",
  "domain": "source_code",
  "from": {
    "type": "File",
    "path": "docs/setup.md"
  },
  "to": {
    "type": "Definition",
    "name": "DatabaseConfig"
  },
  "max_depth": 4,
  "response_format": "llm"
}
```

Use for:

- Verifying doc claims against code.
- Finding which implementation backs a setup or API section.
- Explaining hidden coupling.

## Documentation Queries

### File Ownership

```json
{
  "project_id": "$PROJECT_ID",
  "query_type": "aggregation",
  "domain": "source_code",
  "group_by": ["owner"],
  "metrics": ["file_count", "recent_mr_count"],
  "filters": {
    "paths": ["docs/**", "README.md"]
  },
  "response_format": "llm"
}
```

Use ownership to route questions, not to blame people.

### MR History

```json
{
  "project_id": "$PROJECT_ID",
  "query_type": "search",
  "domain": "merge_requests",
  "query": "recent changes touching authentication setup environment variables",
  "limit": 20,
  "response_format": "llm"
}
```

Use MR history to detect docs that should have changed with code.

### Undocumented Hotspots

```json
{
  "project_id": "$PROJECT_ID",
  "query_type": "aggregation",
  "domain": "source_code",
  "group_by": ["path"],
  "metrics": ["undocumented_public_symbols", "recent_mr_count", "inbound_reference_count"],
  "filters": {
    "undocumented_public_symbols": { "gt": 0 }
  },
  "sort": ["undocumented_public_symbols:desc", "recent_mr_count:desc"],
  "limit": 25,
  "response_format": "llm"
}
```

Use for audit coverage and "what should we document next?"

### Security Context

```json
{
  "project_id": "$PROJECT_ID",
  "query_type": "search",
  "domain": "source_code",
  "query": "authentication authorization secrets tokens encryption destructive operations",
  "node_types": ["Definition", "File"],
  "limit": 40,
  "response_format": "llm"
}
```

Use for security guides, runbooks, and audit findings involving credentials, permissions, or data risk.

## Fallback Exploration

If Orbit is unavailable, use local evidence:

```bash
rg --files -g '*.md' -g '*.mdx' -g 'README*' -g 'docs/**'
rg -n "process\.env|import\.meta\.env|os\.getenv|std::env|ENV\[" .
rg -n "auth|authorize|permission|role|token|secret|encrypt|decrypt" .
git log --name-status --oneline --since='90 days ago'
git diff --name-only origin/main...HEAD
```

State the fallback in the final response: "Orbit was unavailable; audit used local filesystem, ripgrep, and git history."

## Evidence Citation

When using Orbit in output, cite both graph and repo evidence:

```markdown
Evidence: Orbit `Definition:createProject` neighbors `File:src/projects/create.ts`, documented by no node; local path exists at `src/projects/create.ts`.
```

Never publish Orbit-only claims if the corresponding repo path cannot be named.
