# Philip Diff Data Layer

## Source material

- Twitter/X post: Thariq Shihipar, “Using Claude Code: The Unreasonable Effectiveness of HTML” (`https://x.com/trq212/status/2052809885763747935`).
- Example gallery copied locally: [`docs/plans/html-effectiveness/index.html`](./html-effectiveness/index.html).
- Individual example artifacts copied under [`docs/plans/html-effectiveness/`](./html-effectiveness/).

Thariq’s post argues that long agent outputs are often more useful as rich, self-contained HTML artifacts than as walls of Markdown. The key lesson for Philip is not “create an HTML skill.” The lesson is that agents can make better reports, explainers, and review artifacts when they are given the right context.

Philip’s v1 response is a deterministic data layer for branch/PR/diff state. Rendering is downstream and optional.

## Final v1 direction

Add:

```bash
philip diff
```

It writes:

```text
.philip/artifacts/{workstream}/philip-diff.json
```

`philip-diff.json` is the user-facing file. The internal schema/type name is `ActionableDiff`.

V1 does **not** automatically generate Markdown or HTML. It gives humans and agents a factual data model they can use to produce Markdown briefs, HTML artifacts, PR explainers, or handoff prompts.

## Non-goals for v1

- Do not create a new Philip HTML mode.
- Do not create a deterministic HTML renderer.
- Do not automatically write a Markdown branch report.
- Do not include full diff hunks.
- Do not add free-floating `severity`, `confidence`, `importance`, or risk scores.
- Do not build a references/occurrence-scan system.
- Do not silently edit `.gitignore`.
- Do not claim repository semantics such as “canonical doc,” “scratch plan,” “hot path,” or “important module” from paths alone.

## Storage convention

Default output path:

```text
.philip/artifacts/{workstream}/philip-diff.json
```

Workstream naming rule:

1. If on a named branch, sanitize the branch name:
   - `feature/html-artifacts` → `feature-html-artifacts`
   - `ben/actionable-diff@v1` → `ben-actionable-diff-v1`
2. If in detached HEAD, use `detached-{shortSha}`.
3. If not in a Git repo or no branch/commit is available, use `current`.

`.philip/artifacts/` should be treated as generated local output. Philip should tell the user they may want to ignore it, but must not silently modify `.gitignore`.

Future rendering agents may write files beside `philip-diff.json`, such as `index.html`, but v1 `philip diff` only writes JSON.

## Git comparison range rule

1. Use fork point against the configured upstream when available.
2. Else use `origin/main...HEAD` when `origin/main` exists.
3. Else use `main...HEAD` when local `main` exists.
4. Else use staged/unstaged diff when the worktree has changes.
5. Else use the most recent commit as the comparison.
6. If multiple plausible ranges exist and choosing would be misleading, ask the user.
7. Always record the chosen range in `comparison`.

## Collection policy

`philip diff` should collect objective facts and simple aggregations.

Include:

- tracked changed files
- untracked files, clearly marked as `status: "untracked"`
- deleted files with old paths and deletion counts
- renamed files as one record with `oldPath` and `path`
- additions/deletions from Git where available
- repo inventory facts
- changed identifiers from changed lines and whole changed files, with provenance
- local artifact/document metadata for plans, investigations, design docs, reports, and HTML files
- command provenance for the collector

Exclude by default:

```text
.git/**
node_modules/**
.philip/artifacts/**
dist/**
build/**
coverage/**
```

Do not include full diff hunks in v1. A downstream rendering/writing agent can inspect exact files or diffs on demand.

## Minimal `ActionableDiff` model

The JSON should stay factual and small enough to hand to another agent.

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-05-09T00:00:00.000Z",
  "repo": {
    "root": "/path/to/repo",
    "name": "philip"
  },
  "comparison": {
    "baseRef": "origin/main",
    "headRef": "HEAD",
    "mergeBase": "abc123",
    "range": "origin/main...HEAD",
    "strategy": "upstream_fork_point"
  },
  "provenance": [
    {
      "command": "git diff --numstat origin/main...HEAD",
      "exitCode": 0,
      "capturedAt": "2026-05-09T00:00:00.000Z",
      "outputIncluded": false
    }
  ],
  "metrics": {
    "filesChanged": 0,
    "additions": 0,
    "deletions": 0,
    "trackedFilesChanged": 0,
    "untrackedFiles": 0,
    "deletedFiles": 0,
    "renamedFiles": 0,
    "docsFilesChanged": 0,
    "sourceFilesChanged": 0,
    "testFilesChanged": 0,
    "localArtifactsFound": 0,
    "htmlArtifactsFound": 0,
    "identifierCount": 0
  },
  "repoInventory": {
    "topLevelEntries": [
      { "path": "bin", "type": "directory" },
      { "path": "package.json", "type": "file" }
    ],
    "fileCountsByExtension": {
      ".md": 0,
      ".js": 0,
      ".json": 0
    },
    "knownManifests": ["package.json"],
    "knownWorkflowFiles": [".github/workflows/publish.yml"],
    "changedFilesByTopLevel": {
      "docs": 0,
      "root": 0
    },
    "largestChangedFiles": [
      {
        "path": "docs/plans/html-artifacts-for-philip.md",
        "additions": 0,
        "deletions": 0
      }
    ]
  },
  "changedFiles": [
    {
      "path": "README.md",
      "oldPath": null,
      "status": "modified",
      "additions": 0,
      "deletions": 0,
      "extension": ".md",
      "surface": "docs",
      "isDoc": true,
      "isTest": false,
      "isUntracked": false
    }
  ],
  "changedSurfaces": [
    {
      "name": "docs",
      "files": ["README.md"],
      "additions": 0,
      "deletions": 0
    }
  ],
  "changedIdentifiers": [
    {
      "value": "PHILIP_AUTO_INSTALL",
      "kind": "env_var",
      "sourcePath": "README.md",
      "source": "changed_line"
    }
  ],
  "localArtifacts": [
    {
      "path": "docs/plans/html-artifacts-for-philip.md",
      "kind": "plan",
      "title": "Philip Diff Data Layer",
      "createdAt": null,
      "modifiedAt": "2026-05-09T00:00:00.000Z",
      "changedInComparison": true,
      "sizeBytes": 0,
      "headings": ["Source material", "Final v1 direction"]
    }
  ],
  "verification": {
    "testsChanged": [],
    "commandsDiscovered": [],
    "commandsRun": [],
    "notRun": []
  }
}
```

Field notes:

- `surface` is a coarse mechanical category for grouping, not an importance claim.
- `localArtifacts.kind` is a best-effort path/extension label for filtering; it is not a claim that the file is canonical or non-canonical.
- `changedIdentifiers.source` should distinguish `changed_line` from `changed_file` so downstream agents can choose their own precision/noise tradeoff.
- `provenance` records commands used to build the model, but raw command output is not included by default.

## Collector script direction

V1 should include a deterministic collector script rather than relying on every agent to run ad hoc Git commands.

Preferred shape:

```text
scripts/collect-philip-diff.mjs
```

- Dependency-light Node script; Philip already requires Node >=18.
- Runs Git/filesystem commands.
- Normalizes output into `ActionableDiff`.
- Writes `.philip/artifacts/{workstream}/philip-diff.json`.
- Records command provenance.
- Does not include raw command output by default.

Expose it through the existing CLI as:

```bash
philip diff
```

## Optional downstream rendering prompt

Philip may ship a reference prompt that explains the data model to another agent. The prompt should not prescribe layout, style, priority order, or interpretation policy.

Prompt shape:

```text
You are given a Philip `ActionableDiff` JSON model collected from Git and local project files.

The JSON describes objective diff state: repo/comparison metadata, changed files, changed surfaces, identifiers, local artifact metadata, repo inventory, verification data, and command provenance.

Treat the JSON as the evidence boundary. Do not invent facts that are not present. If you make claims beyond the JSON, inspect the referenced files or Git data and cite paths/commands.

Use the user's requested audience, tone, and purpose to decide what to produce. You may create a Markdown brief, HTML artifact, PR explainer, or agent handoff prompt when asked.

If generating HTML, make it self-contained. Inline CSS and small inline JavaScript are allowed. Do not use external network assets.
```

## README / release note positioning

Suggested language:

> Inspired by Thariq Shihipar’s “Unreasonable Effectiveness of HTML,” Philip now provides a deterministic `philip diff` data layer for branch, PR, and local-work review. It writes `philip-diff.json`, a compact model of changed files, repo inventory, identifiers, local artifacts, and command provenance. Agents can use that model to create better Markdown briefs, HTML review artifacts, PR explainers, and handoff prompts without Philip becoming an HTML app builder.

Example user prompts after running `philip diff`:

```text
Read .philip/artifacts/{workstream}/philip-diff.json and write a concise Markdown PR brief. Use the JSON for branch/diff facts. If you make claims beyond the JSON, inspect the referenced files and cite paths.
```

```text
Read .philip/artifacts/{workstream}/philip-diff.json. Use it as the evidence/data model for a self-contained HTML review artifact. Choose the layout and filters based on the data and my goal. Do not invent facts not supported by the JSON or files you inspect.
```

```text
Read .philip/artifacts/{workstream}/philip-diff.json and create a handoff prompt for another agent to verify this branch. Include the comparison range, changed files, untracked files, discovered local artifacts, and specific files worth inspecting.
```

## Future extensions

Possible later work, explicitly not v1:

- `gitActivity`: raw history aggregations such as commits touching changed files/directories and recent change counts.
- Occurrence scan for potential missed updates, as a separate opt-in workflow.
- Markdown branch-state brief written by Philip.
- HTML artifact generation workflow when the user explicitly asks.
- Top-level `.philip/artifacts/index.html` if generated visual artifacts become common.
- Publish/share target such as `docs/artifacts/{workstream}/` when the user wants artifacts committed.
- Heuristic flags, only if derived from documented rules and shown with underlying metrics.

## Dogfood checklist before release

- Run `philip diff` on Philip itself.
- Inspect `philip-diff.json` for correctness and noise.
- Ask an agent to write a Markdown PR brief from the JSON.
- Ask an agent to create a self-contained HTML artifact from the JSON.
- Confirm both outputs are more useful than asking the agent to inspect the repo from scratch.
- Update README/release notes with examples that match real dogfood results.
