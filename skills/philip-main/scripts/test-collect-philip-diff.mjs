#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const philipRoot = path.resolve(__dirname, "..");
const philipBin = path.join(philipRoot, "bin", "philip.js");

test("philip diff writes ActionableDiff JSON for a modified tracked file", (t) => {
  const repo = makeTempRepo(t);
  writeFile(repo, "README.md", "# Example\n\nInitial text.\n");
  commitAll(repo, "Initial commit");

  const gitignoreBefore = snapshotGitignore(repo);
  writeFile(repo, "README.md", "# Example\n\nChanged text.\n");

  const result = runPhilipDiff(repo);
  assert.equal(
    result.status,
    0,
    `expected philip diff to succeed for a modified tracked file\n${formatResult(
      result
    )}`
  );

  assert.match(
    result.stdout,
    /Wrote Philip diff data to \.philip\/artifacts\/main\/philip-diff\.json/,
    `expected stdout to include the repo-relative output path\n${formatResult(
      result
    )}`
  );

  assertNoGitignoreMutation(repo, gitignoreBefore);

  const actionableDiff = readActionableDiff(repo);
  assert.equal(actionableDiff.schemaVersion, 1);
  assert.equal(actionableDiff.repo?.name, path.basename(repo.root));
  assert.ok(actionableDiff.repo?.root, "expected repo.root to be present");
  assert.ok(actionableDiff.comparison, "expected comparison section");
  assert.ok(actionableDiff.metrics, "expected metrics section");
  assert.ok(actionableDiff.repoInventory, "expected repoInventory section");
  assert.ok(Array.isArray(actionableDiff.provenance), "expected provenance array");
  assert.ok(Array.isArray(actionableDiff.changedFiles), "expected changedFiles array");
  assert.ok(
    Array.isArray(actionableDiff.changedSurfaces),
    "expected changedSurfaces array"
  );
  assert.ok(
    Array.isArray(actionableDiff.changedIdentifiers),
    "expected changedIdentifiers array"
  );
  assert.ok(
    Array.isArray(actionableDiff.localArtifacts),
    "expected localArtifacts array"
  );
  assert.ok(actionableDiff.verification, "expected verification section");

  const help = runNode([philipBin, "help"], { cwd: philipRoot });
  assert.equal(help.status, 0, `expected philip help to succeed\n${formatResult(help)}`);
  assert.match(
    help.stdout,
    /philip diff/,
    `expected help output to mention philip diff\n${formatResult(help)}`
  );
});

test("comparison uses local main range on a feature branch without a remote", (t) => {
  const repo = makeTempRepo(t);
  writeFile(repo, "README.md", "# Example\n");
  commitAll(repo, "Initial commit");
  checkoutBranch(repo, "feature/comparison", { create: true });
  writeFile(repo, "feature.txt", "feature work\n");
  commitAll(repo, "Add feature work");

  const { actionableDiff } = collectPhilipDiff(repo);
  const mergeBase = git(repo, ["merge-base", "main", "HEAD"]).stdout.trim();

  assert.equal(actionableDiff.comparison.strategy, "local_main");
  assert.equal(actionableDiff.comparison.baseRef, "main");
  assert.equal(actionableDiff.comparison.headRef, "HEAD");
  assert.equal(actionableDiff.comparison.range, "main...HEAD");
  assert.equal(actionableDiff.comparison.mergeBase, mergeBase);
});

test("comparison falls back to dirty worktree when no branch comparison exists", (t) => {
  const repo = makeTempRepo(t, { branch: "feature-only" });
  writeFile(repo, "README.md", "# Example\n\nInitial text.\n");
  commitAll(repo, "Initial commit");
  writeFile(repo, "README.md", "# Example\n\nDirty tracked text.\n");

  const { actionableDiff } = collectPhilipDiff(repo);

  assert.equal(actionableDiff.comparison.strategy, "worktree");
  assert.equal(actionableDiff.comparison.baseRef, "HEAD");
  assert.equal(actionableDiff.comparison.headRef, "HEAD");
  assert.equal(actionableDiff.comparison.range, "worktree");
  assert.equal(actionableDiff.comparison.mergeBase, null);
});

test("comparison falls back to the most recent commit when no branch comparison or dirty worktree exists", (t) => {
  const repo = makeTempRepo(t, { branch: "feature-only" });
  writeFile(repo, "README.md", "# Example\n");
  commitAll(repo, "Initial commit");
  writeFile(repo, "CHANGELOG.md", "# Changelog\n");
  commitAll(repo, "Add changelog");

  const { actionableDiff } = collectPhilipDiff(repo);

  assert.equal(actionableDiff.comparison.strategy, "recent_commit");
  assert.equal(actionableDiff.comparison.baseRef, "HEAD^");
  assert.equal(actionableDiff.comparison.headRef, "HEAD");
  assert.equal(actionableDiff.comparison.range, "HEAD^..HEAD");
  assert.equal(actionableDiff.comparison.mergeBase, null);
});

test("root commit comparison collects the committed file instead of the commit id", (t) => {
  const repo = makeTempRepo(t);
  writeFile(repo, "README.md", "# Example\n");
  commitAll(repo, "Initial commit");

  const { actionableDiff } = collectPhilipDiff(repo);
  const readme = changedFile(actionableDiff.changedFiles, "README.md");

  assert.equal(actionableDiff.comparison.strategy, "root_commit");
  assert.equal(readme.status, "added");
  assert.equal(readme.additions, 1);
  assert.equal(actionableDiff.metrics.filesChanged, 1);
  assert.equal(
    actionableDiff.changedFiles.some((file) => file.path === "A"),
    false,
    "root commit parser must not treat status tokens as paths"
  );
});

test("branch comparison includes dirty tracked worktree files", (t) => {
  const repo = makeTempRepo(t);
  writeFile(repo, "README.md", "# Example\n");
  writeFile(repo, "src/dirty.js", "const dirtyValue = 1;\n");
  commitAll(repo, "Initial commit");

  checkoutBranch(repo, "feature/dirty-tracked", { create: true });
  writeFile(repo, "feature.js", "export const featureValue = true;\n");
  commitAll(repo, "Add feature file");
  writeFile(repo, "src/dirty.js", "const dirtyValue = 2;\n");

  const { actionableDiff } = collectPhilipDiff(repo);

  assert.equal(actionableDiff.comparison.strategy, "local_main");
  assert.equal(changedFile(actionableDiff.changedFiles, "feature.js").status, "added");
  assert.equal(changedFile(actionableDiff.changedFiles, "src/dirty.js").status, "modified");
  assertIdentifier(actionableDiff.changedIdentifiers, {
    value: "dirtyValue",
    kind: "js_identifier",
    sourcePath: "src/dirty.js",
    source: "changed_line",
  });
});

test("worktree comparison coalesces staged rename plus unstaged edit", (t) => {
  const repo = makeTempRepo(t, { branch: "feature-only" });
  writeFile(repo, "src/old.js", "export const renamedValue = 1;\n");
  commitAll(repo, "Initial commit");

  renameFile(repo, "src/old.js", "src/new.js");
  git(repo, ["add", "-A"]);
  writeFile(repo, "src/new.js", "export const renamedValue = 2;\n");

  const { actionableDiff } = collectPhilipDiff(repo);
  const newPathRecords = actionableDiff.changedFiles.filter(
    (file) => file.path === "src/new.js"
  );

  assert.equal(actionableDiff.comparison.strategy, "worktree");
  assert.equal(newPathRecords.length, 1);
  assert.equal(newPathRecords[0].status, "renamed");
  assert.equal(newPathRecords[0].oldPath, "src/old.js");
});

test("comparison provenance records Git probes without command output", (t) => {
  const repo = makeTempRepo(t);
  writeFile(repo, "README.md", "# Example\n");
  commitAll(repo, "Initial commit");
  checkoutBranch(repo, "feature/provenance", { create: true });
  writeFile(repo, "feature.txt", "feature work\n");
  commitAll(repo, "Add feature work");

  const { actionableDiff } = collectPhilipDiff(repo);

  assert.ok(
    actionableDiff.provenance.length >= 3,
    "expected comparison resolution to record Git command provenance"
  );
  assert.ok(
    actionableDiff.provenance.some(
      (entry) => entry.command === "git rev-parse --show-toplevel"
    ),
    "expected repo root Git probe in provenance"
  );
  assert.ok(
    actionableDiff.provenance.some((entry) => entry.command.includes("merge-base")),
    "expected merge-base Git probe in provenance"
  );

  for (const entry of actionableDiff.provenance) {
    assert.equal(entry.outputIncluded, false);
    assert.equal(Object.hasOwn(entry, "stdout"), false);
    assert.equal(Object.hasOwn(entry, "stderr"), false);
  }
});

test("changedFiles captures tracked statuses, renames, spaces, and untracked files", (t) => {
  const repo = makeTempRepo(t);
  writeFile(repo, "src/modified.js", "const value = 1;\n");
  writeFile(repo, "src/old name.js", "export const oldName = true;\n");
  writeFile(repo, "delete-me.txt", "delete me\n");
  commitAll(repo, "Initial commit");

  checkoutBranch(repo, "feature/changed-files", { create: true });
  writeFile(repo, "src/modified.js", "const value = 2;\n");
  writeFile(repo, "src/new file.js", "export const added = true;\n");
  writeFile(repo, "docs/nested/path with spaces.md", "# Nested Doc\n");
  writeFile(repo, "src/example.test.js", "test('example', () => {});\n");
  renameFile(repo, "src/old name.js", "src/new name.js");
  deleteFile(repo, "delete-me.txt");
  commitAll(repo, "Change tracked files");
  writeFile(repo, "notes/untracked file.md", "# Local notes\n");

  const { actionableDiff } = collectPhilipDiff(repo);
  const changedFiles = actionableDiff.changedFiles;

  assert.deepEqual(
    changedFiles.map((file) => file.path),
    [
      "delete-me.txt",
      "docs/nested/path with spaces.md",
      "notes/untracked file.md",
      "src/example.test.js",
      "src/modified.js",
      "src/new file.js",
      "src/new name.js",
    ]
  );

  assert.equal(changedFile(changedFiles, "src/modified.js").status, "modified");
  assert.equal(changedFile(changedFiles, "src/new file.js").status, "added");
  assert.equal(changedFile(changedFiles, "delete-me.txt").status, "deleted");
  assert.equal(changedFile(changedFiles, "delete-me.txt").deletions, 1);

  const renamed = changedFile(changedFiles, "src/new name.js");
  assert.equal(renamed.status, "renamed");
  assert.equal(renamed.oldPath, "src/old name.js");

  const untracked = changedFile(changedFiles, "notes/untracked file.md");
  assert.equal(untracked.status, "untracked");
  assert.equal(untracked.isUntracked, true);
  assert.equal(untracked.additions, null);
  assert.equal(untracked.deletions, null);

  const doc = changedFile(changedFiles, "docs/nested/path with spaces.md");
  assert.equal(doc.extension, ".md");
  assert.equal(doc.surface, "docs");
  assert.equal(doc.isDoc, true);

  const testFile = changedFile(changedFiles, "src/example.test.js");
  assert.equal(testFile.surface, "test");
  assert.equal(testFile.isTest, true);
});

test("generated and vendor paths are excluded without hiding similarly named files", (t) => {
  const repo = makeTempRepo(t);
  writeFile(repo, "README.md", "# Example\n");
  commitAll(repo, "Initial commit");

  checkoutBranch(repo, "feature/exclusions", { create: true });
  const gitignoreBefore = snapshotGitignore(repo);

  writeFile(repo, "node_modules/pkg/index.js", "module.exports = {};\n");
  writeFile(repo, ".philip/artifacts/main/generated.html", "<title>Generated</title>\n");
  writeFile(repo, "dist/app.js", "console.log('dist');\n");
  writeFile(repo, "build/app.js", "console.log('build');\n");
  writeFile(repo, "coverage/coverage.json", "{}\n");
  writeFile(repo, ".tmp/cache.md", "# Temp\n");
  writeFile(repo, ".worktrees/attempt/README.md", "# Worktree\n");
  writeFile(repo, ".pi/session.json", "{}\n");
  writeFile(repo, ".beads/beads.db", "runtime db\n");
  writeFile(repo, ".beads/beads.db-wal", "runtime wal\n");
  writeFile(repo, ".beads/runtime.lock", "runtime lock\n");
  writeFile(repo, ".beads/last-touched", "runtime marker\n");
  writeFile(repo, ".beads/.br_history/history", "runtime history\n");
  writeFile(repo, ".beads/issues.jsonl", "{}\n");
  writeFile(repo, "build-notes.md", "# Build Notes\n");
  writeFile(repo, "docs/build-guide.md", "# Build Guide\n");
  commitAll(repo, "Add excluded and allowed paths");

  writeFile(repo, "node_modules/pkg/local.js", "module.exports = 'local';\n");
  writeFile(repo, ".philip/artifacts/main/local.html", "<title>Local</title>\n");
  writeFile(repo, "dist/local.js", "console.log('local dist');\n");
  writeFile(repo, "build/local.js", "console.log('local build');\n");
  writeFile(repo, "coverage/local.json", "{}\n");
  writeFile(repo, ".tmp/local.md", "# Local Temp\n");
  writeFile(repo, ".worktrees/attempt/local.md", "# Local Worktree\n");
  writeFile(repo, ".pi/local.json", "{}\n");
  writeFile(repo, ".beads/local.db", "runtime db\n");

  const { actionableDiff } = collectPhilipDiff(repo);
  const changedPaths = actionableDiff.changedFiles.map((file) => file.path);

  assert.deepEqual(changedPaths, [".beads/issues.jsonl", "build-notes.md", "docs/build-guide.md"]);
  assertNoExcludedPaths(actionableDiff.changedFiles.map((file) => file.path));
  assertNoExcludedPaths(
    actionableDiff.changedFiles.map((file) => file.oldPath).filter(Boolean)
  );
  assertNoExcludedPaths(JSON.stringify(actionableDiff.repoInventory));
  assertNoExcludedPaths(JSON.stringify(actionableDiff.changedIdentifiers));
  assertNoExcludedPaths(JSON.stringify(actionableDiff.localArtifacts));
  assertNoGitignoreMutation(repo, gitignoreBefore);
});

test("workstream artifact paths use sanitized branch names", (t) => {
  const repo = makeTempRepo(t);
  writeFile(repo, "README.md", "# Example\n");
  commitAll(repo, "Initial commit");

  checkoutBranch(repo, "feature/html-artifacts", { create: true });
  let collected = collectPhilipDiff(repo);
  assertOutputPath(
    repo,
    collected.result,
    ".philip/artifacts/feature-html-artifacts/philip-diff.json"
  );
  fs.rmSync(path.join(repo.root, ".philip"), { recursive: true, force: true });

  checkoutBranch(repo, "main");
  checkoutBranch(repo, "ben/actionable-diff@v1", { create: true });
  collected = collectPhilipDiff(repo);
  assertOutputPath(
    repo,
    collected.result,
    ".philip/artifacts/ben-actionable-diff-v1/philip-diff.json"
  );
});

test("workstream artifact path uses detached short SHA", (t) => {
  const repo = makeTempRepo(t);
  writeFile(repo, "README.md", "# Example\n");
  commitAll(repo, "Initial commit");
  detachHead(repo);

  const shortSha = git(repo, ["rev-parse", "--short", "HEAD"]).stdout.trim();
  const { result } = collectPhilipDiff(repo);

  assertOutputPath(
    repo,
    result,
    `.philip/artifacts/detached-${shortSha}/philip-diff.json`
  );
});

test("workstream artifact path falls back to current outside Git", (t) => {
  const repo = makeTempDir(t);
  const gitignoreBefore = snapshotGitignore(repo);
  const { result, actionableDiff } = collectPhilipDiff(repo);

  assert.equal(actionableDiff.comparison.strategy, "non_git");
  assertOutputPath(repo, result, ".philip/artifacts/current/philip-diff.json");
  assertNoGitignoreMutation(repo, gitignoreBefore);
});

test("changedIdentifiers captures changed-line and changed-file tokens", (t) => {
  const repo = makeTempRepo(t);
  writeFile(repo, "README.md", "# Example\n");
  commitAll(repo, "Initial commit");

  checkoutBranch(repo, "feature/identifiers", { create: true });
  writeFile(
    repo,
    "src/config.js",
    [
      "const PHILIP_AUTO_INSTALL = process.env.PHILIP_AUTO_INSTALL;",
      "function runPhilipDiff() {",
      "  return \"--dry-run docs/guide.md\";",
      "}",
      "",
    ].join("\n")
  );
  writeFile(
    repo,
    "package.json",
    JSON.stringify({ scripts: { check: "node scripts/check.js" } }, null, 2)
  );
  commitAll(repo, "Add identifier sources");
  writeFile(
    repo,
    "notes/untracked.md",
    "UNTRACKED_TOKEN should mention --local-flag and docs/untracked.md\n"
  );
  writeFile(
    repo,
    "node_modules/pkg/ignored.js",
    "const IGNORED_SECRET = '--ignored-flag';\n"
  );

  const { actionableDiff } = collectPhilipDiff(repo);
  const identifiers = actionableDiff.changedIdentifiers;

  assertIdentifier(identifiers, {
    value: "PHILIP_AUTO_INSTALL",
    kind: "env_var",
    sourcePath: "src/config.js",
    source: "changed_line",
  });
  assertIdentifier(identifiers, {
    value: "--dry-run",
    kind: "cli_flag",
    sourcePath: "src/config.js",
    source: "changed_line",
  });
  assertIdentifier(identifiers, {
    value: "runPhilipDiff",
    kind: "js_identifier",
    sourcePath: "src/config.js",
    source: "changed_line",
  });
  assertIdentifier(identifiers, {
    value: "docs/guide.md",
    kind: "path",
    sourcePath: "src/config.js",
    source: "changed_line",
  });
  assertIdentifier(identifiers, {
    value: "check",
    kind: "npm_script",
    sourcePath: "package.json",
    source: "changed_line",
  });
  assertIdentifier(identifiers, {
    value: "UNTRACKED_TOKEN",
    kind: "env_var",
    sourcePath: "notes/untracked.md",
    source: "changed_file",
  });

  assert.equal(
    identifiers.some((identifier) => identifier.value === "IGNORED_SECRET"),
    false,
    "expected excluded directories not to contribute identifiers"
  );
  assert.equal(JSON.stringify(actionableDiff).includes("@@"), false);
});

test("localArtifacts surfaces plans, reports, designs, and HTML metadata", (t) => {
  const repo = makeTempRepo(t);
  writeFile(repo, "README.md", "# Example\n");
  writeFile(repo, "docs/design-overview.md", "# Design Overview\n\n## Principles\n");
  writeFile(repo, "reports/audit-report.md", "# Audit Report\n\n## Findings\n");
  commitAll(repo, "Initial docs");

  checkoutBranch(repo, "feature/local-artifacts", { create: true });
  writeFile(repo, "docs/plans/example.md", "# Example Plan\n\n## Step One\n");
  writeFile(
    repo,
    "prototype/example.html",
    "<!doctype html><title>Prototype Demo</title><h1>Demo</h1>\n"
  );
  commitAll(repo, "Add local artifacts");
  writeFile(
    repo,
    ".philip/artifacts/main/generated.html",
    "<title>Generated Artifact</title>\n"
  );

  const { actionableDiff } = collectPhilipDiff(repo);
  const artifacts = actionableDiff.localArtifacts;

  const plan = localArtifact(artifacts, "docs/plans/example.md");
  assert.equal(plan.kind, "plan");
  assert.equal(plan.title, "Example Plan");
  assert.deepEqual(plan.headings, ["Example Plan", "Step One"]);
  assert.equal(plan.changedInComparison, true);
  assert.equal(plan.createdAt, null);
  assert.equal(typeof plan.modifiedAt, "string");
  assert.equal(typeof plan.sizeBytes, "number");

  const report = localArtifact(artifacts, "reports/audit-report.md");
  assert.equal(report.kind, "report");
  assert.equal(report.changedInComparison, false);

  const design = localArtifact(artifacts, "docs/design-overview.md");
  assert.equal(design.kind, "design");
  assert.equal(design.changedInComparison, false);

  const html = localArtifact(artifacts, "prototype/example.html");
  assert.equal(html.kind, "html");
  assert.equal(html.title, "Prototype Demo");
  assert.equal(html.changedInComparison, true);

  assert.equal(
    artifacts.some((artifact) => artifact.path.startsWith(".philip/artifacts/")),
    false,
    "expected generated Philip artifacts to be ignored"
  );
});

test("metrics, repoInventory, and changedSurfaces are factual and deterministic", (t) => {
  const repo = makeTempRepo(t);
  writeFile(repo, "package.json", JSON.stringify({ scripts: { check: "node check.js" } }, null, 2));
  writeFile(repo, "LICENSE", "Example license\n");
  writeFile(repo, ".github/workflows/ci.yml", "name: CI\n");
  writeFile(repo, "src/app.js", "const value = 1;\n");
  commitAll(repo, "Initial inventory");

  checkoutBranch(repo, "feature/metrics", { create: true });
  writeFile(repo, "src/app.js", "const value = 2;\n");
  writeFile(repo, "src/app.test.js", "test('value', () => {});\n");
  writeFile(repo, "docs/guide.md", "# Guide\n");
  writeFile(repo, "docs/plans/metrics-plan.md", "# Metrics Plan\n");
  writeFile(
    repo,
    "prototype/view.html",
    "<title>View Artifact</title>\n<section>One</section>\n<section>Two</section>\n<section>Three</section>\n"
  );
  commitAll(repo, "Add metrics fixtures");
  writeFile(repo, "notes/untracked.md", "# Notes\nIDENTIFIER_TOKEN\n");
  writeFile(repo, "node_modules/pkg/ignored.js", "ignored\n");

  const first = collectPhilipDiff(repo).actionableDiff;
  const metrics = first.metrics;

  assert.equal(metrics.filesChanged, first.changedFiles.length);
  assert.equal(metrics.additions, sumChangedStat(first.changedFiles, "additions"));
  assert.equal(metrics.deletions, sumChangedStat(first.changedFiles, "deletions"));
  assert.equal(
    metrics.trackedFilesChanged,
    first.changedFiles.filter((file) => !file.isUntracked).length
  );
  assert.equal(metrics.untrackedFiles, 1);
  assert.equal(metrics.deletedFiles, 0);
  assert.equal(metrics.renamedFiles, 0);
  assert.equal(metrics.docsFilesChanged, 3);
  assert.equal(metrics.sourceFilesChanged, 1);
  assert.equal(metrics.testFilesChanged, 1);
  assert.equal(metrics.localArtifactsFound, first.localArtifacts.length);
  assert.equal(
    metrics.htmlArtifactsFound,
    first.localArtifacts.filter((artifact) => artifact.kind === "html").length
  );
  assert.equal(metrics.identifierCount, first.changedIdentifiers.length);

  assert.ok(
    first.repoInventory.topLevelEntries.some(
      (entry) => entry.name === ".github" && entry.type === "directory"
    )
  );
  assert.ok(
    first.repoInventory.topLevelEntries.some(
      (entry) => entry.name === "LICENSE" && entry.type === "file"
    )
  );
  assert.equal(first.repoInventory.fileCountsByExtension["(none)"], 1);
  assert.ok(first.repoInventory.fileCountsByExtension[".js"] >= 2);
  assert.deepEqual(first.repoInventory.knownManifests, ["package.json"]);
  assert.deepEqual(first.repoInventory.knownWorkflowFiles, [".github/workflows/ci.yml"]);
  assert.deepEqual(first.repoInventory.changedFilesByTopLevel, {
    docs: 2,
    notes: 1,
    prototype: 1,
    src: 2,
  });
  assert.equal(first.repoInventory.largestChangedFiles[0].path, "prototype/view.html");

  const docsSurface = changedSurface(first.changedSurfaces, "docs");
  assert.deepEqual(docsSurface.files, ["docs/guide.md", "docs/plans/metrics-plan.md", "notes/untracked.md"]);
  assert.equal(changedSurface(first.changedSurfaces, "test").files[0], "src/app.test.js");

  const second = collectPhilipDiff(repo).actionableDiff;
  assert.deepEqual(
    scrubDynamicFields(second, { repoRoot: repo.root }),
    scrubDynamicFields(first, { repoRoot: repo.root })
  );

  const serialized = JSON.stringify(first).toLowerCase();
  for (const forbidden of ["severity", "confidence", "importance", "hot-path"]) {
    assert.equal(serialized.includes(forbidden), false, `did not expect ${forbidden}`);
  }
});

test("verification discovers commands and changed tests without running scripts", (t) => {
  const repo = makeTempRepo(t);
  writeFile(
    repo,
    "package.json",
    JSON.stringify(
      {
        scripts: {
          check: "node check.js",
          test: "node side-effect.js",
          "test:unit": "node unit.js",
          lint: "node lint.js",
          build: "node build.js",
        },
      },
      null,
      2
    )
  );
  writeFile(
    repo,
    "side-effect.js",
    "require('node:fs').writeFileSync('SHOULD_NOT_EXIST', 'ran');\n"
  );
  commitAll(repo, "Initial package scripts");

  checkoutBranch(repo, "feature/verification", { create: true });
  writeFile(repo, "src/app.test.js", "test('value', () => {});\n");
  commitAll(repo, "Add changed test");

  const { actionableDiff } = collectPhilipDiff(repo);
  assert.deepEqual(actionableDiff.verification.commandsDiscovered, [
    "npm run check",
    "npm run lint",
    "npm run test:unit",
    "npm test",
  ]);
  assert.deepEqual(actionableDiff.verification.notRun, actionableDiff.verification.commandsDiscovered);
  assert.deepEqual(actionableDiff.verification.commandsRun, []);
  assert.deepEqual(actionableDiff.verification.testsChanged, ["src/app.test.js"]);
  assert.equal(
    fs.existsSync(path.join(repo.root, "SHOULD_NOT_EXIST")),
    false,
    "philip diff must not execute package scripts"
  );
});

function makeTempRepo(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "philip-diff-"));
  const repo = { root };

  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const init = runGitCommand(repo, ["init", "-b", options.branch || "main"]);
  if (init.status !== 0) {
    git(repo, ["init"]);
    git(repo, ["checkout", "-B", options.branch || "main"]);
  }

  git(repo, ["config", "user.name", "Philip Test"]);
  git(repo, ["config", "user.email", "philip@example.invalid"]);

  return repo;
}

function makeTempDir(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "philip-diff-nongit-"));
  const repo = { root };

  t.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  return repo;
}

function git(repo, args, options = {}) {
  const result = runGitCommand(repo, args, options);
  assert.equal(
    result.status,
    0,
    `expected git command to succeed\n${formatResult(result)}`
  );
  return result;
}

function runGitCommand(repo, args, options = {}) {
  return runCommand("git", args, {
    cwd: options.cwd || repo.root,
    env: options.env,
  });
}

function runPhilipDiff(repo, args = []) {
  return runNode([philipBin, "diff", ...args], { cwd: repo.root });
}

function collectPhilipDiff(repo, args = []) {
  const result = runPhilipDiff(repo, args);
  assert.equal(result.status, 0, `expected philip diff to succeed\n${formatResult(result)}`);
  return {
    result,
    actionableDiff: readActionableDiff(repo),
  };
}

function runNode(args, options = {}) {
  return runCommand(process.execPath, args, options);
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd,
    env: { ...process.env, ...options.env },
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });

  return {
    command: [command, ...args].join(" "),
    cwd: options.cwd || process.cwd(),
    status: typeof result.status === "number" ? result.status : 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    error: result.error,
  };
}

function writeFile(repo, relativePath, contents) {
  const absolutePath = path.join(repo.root, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents);
  return absolutePath;
}

function renameFile(repo, fromRelativePath, toRelativePath) {
  const from = path.join(repo.root, fromRelativePath);
  const to = path.join(repo.root, toRelativePath);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.renameSync(from, to);
}

function deleteFile(repo, relativePath) {
  fs.rmSync(path.join(repo.root, relativePath), { force: true });
}

function commitAll(repo, message) {
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", message]);
}

function checkoutBranch(repo, branch, options = {}) {
  const args = options.create ? ["checkout", "-b", branch] : ["checkout", branch];
  return git(repo, args);
}

function detachHead(repo, ref = "HEAD") {
  return git(repo, ["checkout", "--detach", ref]);
}

function readActionableDiff(repo) {
  const diffPath = locatePhilipDiffJson(repo);
  return JSON.parse(fs.readFileSync(diffPath, "utf8"));
}

function locatePhilipDiffJson(repo) {
  const artifactRoot = path.join(repo.root, ".philip", "artifacts");
  const matches = [];
  walkFiles(artifactRoot, (file) => {
    if (path.basename(file) === "philip-diff.json") {
      matches.push(file);
    }
  });

  assert.equal(
    matches.length,
    1,
    `expected exactly one philip-diff.json under ${artifactRoot}, found ${matches.length}`
  );

  return matches[0];
}

function walkFiles(root, visit) {
  if (!fs.existsSync(root)) {
    return;
  }

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, visit);
    } else if (entry.isFile()) {
      visit(fullPath);
    }
  }
}

function snapshotGitignore(repo) {
  const gitignore = path.join(repo.root, ".gitignore");
  if (!fs.existsSync(gitignore)) {
    return null;
  }

  return fs.readFileSync(gitignore, "utf8");
}

function assertNoGitignoreMutation(repo, before) {
  const after = snapshotGitignore(repo);
  assert.equal(after, before, "expected philip diff not to create or edit .gitignore");
}

function changedFile(changedFiles, filePath) {
  const match = changedFiles.find((file) => file.path === filePath);
  assert.ok(match, `expected changedFiles to include ${filePath}`);
  return match;
}

function assertIdentifier(identifiers, expected) {
  assert.ok(
    identifiers.some((identifier) =>
      Object.entries(expected).every(([key, value]) => identifier[key] === value)
    ),
    `expected changedIdentifiers to include ${JSON.stringify(expected)}`
  );
}

function localArtifact(artifacts, artifactPath) {
  const match = artifacts.find((artifact) => artifact.path === artifactPath);
  assert.ok(match, `expected localArtifacts to include ${artifactPath}`);
  return match;
}

function changedSurface(surfaces, surfaceName) {
  const match = surfaces.find((surface) => surface.surface === surfaceName);
  assert.ok(match, `expected changedSurfaces to include ${surfaceName}`);
  return match;
}

function sumChangedStat(changedFiles, key) {
  return changedFiles.reduce(
    (sum, file) => sum + (typeof file[key] === "number" ? file[key] : 0),
    0
  );
}

function assertNoExcludedPaths(value) {
  const haystack = Array.isArray(value) ? value.join("\n") : String(value);
  for (const excluded of [
    ".git/",
    "node_modules/",
    ".philip/artifacts/",
    "dist/",
    "build/",
    "coverage/",
    ".tmp/",
    ".worktrees/",
    ".pi/",
    ".beads/beads.db",
    ".beads/beads.db-wal",
    ".beads/runtime.lock",
    ".beads/last-touched",
    ".beads/.br_history/",
  ]) {
    assert.equal(
      haystack.includes(excluded),
      false,
      `expected output not to include excluded path prefix ${excluded}`
    );
  }
}

function assertOutputPath(repo, result, relativePath) {
  assert.match(
    result.stdout,
    new RegExp(`${escapeRegExp(relativePath)}(?:\\n|$)`),
    `expected stdout to include ${relativePath}\n${formatResult(result)}`
  );
  assert.equal(
    fs.existsSync(path.join(repo.root, relativePath)),
    true,
    `expected ${relativePath} to exist`
  );
}

function scrubDynamicFields(value, options = {}) {
  const rootPattern = options.repoRoot
    ? new RegExp(escapeRegExp(options.repoRoot.replaceAll(path.sep, "/")), "g")
    : null;

  return JSON.parse(
    JSON.stringify(value, (key, raw) => {
      if (typeof raw !== "string") {
        return raw;
      }

      let stringValue = raw.replaceAll(path.sep, "/");
      if (rootPattern) {
        stringValue = stringValue.replace(rootPattern, "<repo-root>");
      }

      if (key === "generatedAt" || key === "capturedAt" || /At$/.test(key)) {
        return "<timestamp>";
      }

      if (/^[0-9a-f]{7,40}$/i.test(stringValue)) {
        return "<sha>";
      }

      return stringValue;
    })
  );
}

function formatResult(result) {
  const lines = [
    `command: ${result.command}`,
    `cwd: ${result.cwd}`,
    `exit: ${result.status}`,
  ];

  if (result.error) {
    lines.push(`error: ${result.error.message}`);
  }

  lines.push("stdout:", indent(result.stdout || "<empty>"));
  lines.push("stderr:", indent(result.stderr || "<empty>"));
  return lines.join("\n");
}

function indent(value) {
  return value
    .trimEnd()
    .split("\n")
    .map((line) => `  ${line}`)
    .join("\n");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
