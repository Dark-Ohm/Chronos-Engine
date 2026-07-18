#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const EXCLUDED_REPO_PATHS = [
  ".git",
  "node_modules",
  ".philip/artifacts",
  "dist",
  "build",
  "coverage",
  ".tmp",
  ".worktrees",
  ".pi",
];
const WHOLE_FILE_IDENTIFIER_READ_LIMIT = 64 * 1024;

function main() {
  try {
    const options = parseArgs(process.argv.slice(2));
    if (options.help) {
      printHelp();
      return;
    }

    const provenance = [];
    const repo = resolveRepoRoot(process.cwd(), provenance);
    const comparison = resolveComparison(repo, provenance);
    const changedFiles = collectChangedFiles(repo, comparison, provenance);
    const changedIdentifiers = collectChangedIdentifiers(
      repo,
      comparison,
      changedFiles,
      provenance
    );
    const localArtifacts = collectLocalArtifacts(repo, changedFiles);
    const metrics = computeMetrics(changedFiles, changedIdentifiers, localArtifacts);
    const repoInventory = collectRepoInventory(repo, changedFiles);
    const changedSurfaces = collectChangedSurfaces(changedFiles);
    const verification = collectVerification(repo, changedFiles);
    const workstream = resolveWorkstream(repo, provenance);
    const outputRelativePath = toPosix(
      path.join(".philip", "artifacts", workstream, "philip-diff.json")
    );
    const outputPath = path.join(repo.root, outputRelativePath);
    const actionableDiff = emptyActionableDiff({
      repoRoot: repo.root,
      comparison,
      provenance,
      metrics,
      repoInventory,
      changedFiles,
      changedSurfaces,
      changedIdentifiers,
      localArtifacts,
      verification,
    });

    writeJsonAtomic(outputPath, actionableDiff);
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify(
          {
            ok: true,
            artifact: {
              kind: "actionable_diff",
              path: outputRelativePath,
              schemaVersion: actionableDiff.schemaVersion,
            },
            comparison: actionableDiff.comparison,
            metrics: actionableDiff.metrics,
          },
          null,
          2
        )}\n`
      );
    } else {
      process.stdout.write(`Wrote Philip diff data to ${outputRelativePath}\n`);
    }
  } catch (error) {
    process.stderr.write(`philip diff: ${error.message}\n`);
    process.exitCode = error instanceof UserInputError ? 2 : 1;
  }
}

class UserInputError extends Error {
  constructor(message) {
    super(message);
    this.name = "UserInputError";
  }
}

function parseArgs(argv) {
  const options = {
    help: false,
    json: false,
  };

  for (const arg of argv) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg.startsWith("-")) {
      const suggestion = arg === "--jsno" || arg === "--jsoon" ? "\nDid you mean `--json`?" : "";
      throw new UserInputError(
        `Unknown option: ${arg}${suggestion}\nRun \`philip diff --help\` for usage.`
      );
    } else {
      throw new UserInputError(
        `Unexpected argument: ${arg}\nRun \`philip diff --help\` for usage.`
      );
    }
  }

  return options;
}

function printHelp() {
  process.stdout.write(`Usage:
  philip diff [--json]

Write an Actionable diff JSON evidence packet to .philip/artifacts/{workstream}/philip-diff.json.

Options:
  --json             Print a machine-readable result envelope to stdout
  -h, --help         Show this help without writing artifacts
`);
}

function runGit(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: options.cwd || process.cwd(),
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });

  const command = ["git", ...args].join(" ");
  const status = typeof result.status === "number" ? result.status : 1;

  if (options.provenance) {
    addProvenance(options.provenance, {
      command,
      exitCode: status,
    });
  }

  return {
    ok: status === 0 && !result.error,
    status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
    command,
    error: result.error,
  };
}

function addProvenance(provenance, entry) {
  provenance.push({
    command: entry.command,
    exitCode: entry.exitCode,
    capturedAt: new Date().toISOString(),
    outputIncluded: false,
  });
}

function resolveRepoRoot(cwd, provenance) {
  const result = runGit(["rev-parse", "--show-toplevel"], {
    cwd,
    provenance,
  });

  if (result.ok) {
    const root = result.stdout.trim();
    if (root) {
      return { root, isGit: true };
    }
  }

  return { root: cwd, isGit: false };
}

function resolveComparison(repo, provenance) {
  if (!repo.isGit) {
    return {
      strategy: "non_git",
      baseRef: null,
      headRef: null,
      mergeBase: null,
      range: null,
    };
  }

  const upstream = runGit(
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
    { cwd: repo.root, provenance }
  );

  if (upstream.ok) {
    const upstreamRef = upstream.stdout.trim();
    const forkPoint = runGit(["merge-base", "--fork-point", upstreamRef, "HEAD"], {
      cwd: repo.root,
      provenance,
    });

    if (forkPoint.ok) {
      const mergeBase = forkPoint.stdout.trim();
      return {
        strategy: "upstream_fork_point",
        baseRef: upstreamRef,
        headRef: "HEAD",
        mergeBase,
        range: `${mergeBase}...HEAD`,
      };
    }
  }

  const originMain = resolveRevisionComparison(repo, provenance, {
    ref: "origin/main",
    strategy: "origin_main",
  });
  if (originMain) {
    return originMain;
  }

  const currentBranch = resolveCurrentBranch(repo, provenance);
  if (currentBranch !== "main") {
    const localMain = resolveRevisionComparison(repo, provenance, {
      ref: "main",
      strategy: "local_main",
    });
    if (localMain) {
      return localMain;
    }
  }

  if (hasDirtyTrackedWorktree(repo, provenance)) {
    return {
      strategy: "worktree",
      baseRef: "HEAD",
      headRef: "HEAD",
      mergeBase: null,
      range: "worktree",
    };
  }

  return resolveRecentCommitComparison(repo, provenance);
}

function resolveRevisionComparison(repo, provenance, { ref, strategy }) {
  const refExists = runGit(["rev-parse", "--verify", `${ref}^{commit}`], {
    cwd: repo.root,
    provenance,
  });

  if (!refExists.ok) {
    return null;
  }

  const mergeBase = runGit(["merge-base", ref, "HEAD"], {
    cwd: repo.root,
    provenance,
  });

  if (!mergeBase.ok) {
    return null;
  }

  return {
    strategy,
    baseRef: ref,
    headRef: "HEAD",
    mergeBase: mergeBase.stdout.trim(),
    range: `${ref}...HEAD`,
  };
}

function resolveCurrentBranch(repo, provenance) {
  const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: repo.root,
    provenance,
  });

  if (!branch.ok) {
    return null;
  }

  return branch.stdout.trim() || null;
}

function hasDirtyTrackedWorktree(repo, provenance) {
  const status = runGit(["status", "--porcelain=v1", "--untracked-files=no"], {
    cwd: repo.root,
    provenance,
  });

  return status.ok && status.stdout.trim().length > 0;
}

function resolveRecentCommitComparison(repo, provenance) {
  const head = runGit(["rev-parse", "--verify", "HEAD"], {
    cwd: repo.root,
    provenance,
  });

  if (!head.ok) {
    return {
      strategy: "no_commit",
      baseRef: null,
      headRef: null,
      mergeBase: null,
      range: null,
    };
  }

  const parent = runGit(["rev-parse", "--verify", "HEAD^"], {
    cwd: repo.root,
    provenance,
  });

  if (!parent.ok) {
    return {
      strategy: "root_commit",
      baseRef: null,
      headRef: "HEAD",
      mergeBase: null,
      range: "HEAD",
    };
  }

  return {
    strategy: "recent_commit",
    baseRef: "HEAD^",
    headRef: "HEAD",
    mergeBase: null,
    range: "HEAD^..HEAD",
  };
}

function collectChangedFiles(repo, comparison, provenance) {
  if (!repo.isGit) {
    return [];
  }

  const records = new Map();

  if (comparison.strategy === "worktree") {
    mergeChangedRecords(
      records,
      collectDiffRecords(repo, provenance, {
        nameStatusArgs: ["diff", "--name-status", "-M", "-z"],
        numstatArgs: ["diff", "--numstat", "-M", "-z"],
      })
    );
    mergeChangedRecords(
      records,
      collectDiffRecords(repo, provenance, {
        nameStatusArgs: ["diff", "--cached", "--name-status", "-M", "-z"],
        numstatArgs: ["diff", "--cached", "--numstat", "-M", "-z"],
      })
    );
  } else if (comparison.strategy === "root_commit") {
    mergeChangedRecords(
      records,
      collectDiffRecords(repo, provenance, {
        nameStatusArgs: [
          "diff-tree",
          "--root",
          "--no-commit-id",
          "-r",
          "--name-status",
          "-M",
          "-z",
          "HEAD",
        ],
        numstatArgs: [
          "diff-tree",
          "--root",
          "--no-commit-id",
          "-r",
          "--numstat",
          "-M",
          "-z",
          "HEAD",
        ],
      })
    );
  } else if (comparison.range) {
    const diffTarget = comparison.mergeBase || comparison.range;
    mergeChangedRecords(
      records,
      collectDiffRecords(repo, provenance, {
        nameStatusArgs: ["diff", "--name-status", "-M", "-z", diffTarget],
        numstatArgs: ["diff", "--numstat", "-M", "-z", diffTarget],
      })
    );
  }

  mergeChangedRecords(records, collectUntrackedFiles(repo, provenance));

  return [...records.values()]
    .filter(
      (record) =>
        !isExcludedRepoPath(record.path) &&
        !(record.oldPath && isExcludedRepoPath(record.oldPath))
    )
    .sort(compareChangedFiles);
}

function collectDiffRecords(repo, provenance, { nameStatusArgs, numstatArgs }) {
  const nameStatus = runGit(nameStatusArgs, { cwd: repo.root, provenance });
  if (!nameStatus.ok) {
    return [];
  }

  const numstat = runGit(numstatArgs, { cwd: repo.root, provenance });
  const counts = numstat.ok ? parseNumstatZ(numstat.stdout) : new Map();

  return parseNameStatusZ(nameStatus.stdout)
    .filter(
      (entry) =>
        !isExcludedRepoPath(entry.path) &&
        !(entry.oldPath && isExcludedRepoPath(entry.oldPath))
    )
    .map((entry) => {
      const key = changedFileKey(entry.path, entry.oldPath);
      const stat = counts.get(key) || counts.get(changedFileKey(entry.path));
      return buildChangedFile({
        ...entry,
        additions: stat ? stat.additions : null,
        deletions: stat ? stat.deletions : null,
        isUntracked: false,
      });
    });
}

function parseNameStatusZ(stdout) {
  const parts = splitNul(stdout);
  const records = [];

  for (let index = 0; index < parts.length; ) {
    const code = parts[index++];
    if (!code) {
      continue;
    }

    if (code.startsWith("R")) {
      const oldPath = normalizeRepoPath(parts[index++]);
      const newPath = normalizeRepoPath(parts[index++]);
      records.push({ status: "renamed", oldPath, path: newPath });
      continue;
    }

    const pathValue = normalizeRepoPath(parts[index++]);
    records.push({
      status: statusFromGitCode(code),
      path: pathValue,
    });
  }

  return records;
}

function parseNumstatZ(stdout) {
  const parts = splitNul(stdout);
  const counts = new Map();

  for (let index = 0; index < parts.length; ) {
    const head = parts[index++];
    if (!head) {
      continue;
    }

    const fields = head.split("\t");
    if (fields.length < 3) {
      continue;
    }

    const additions = parseStatNumber(fields[0]);
    const deletions = parseStatNumber(fields[1]);

    if (fields[2] === "") {
      const oldPath = normalizeRepoPath(parts[index++]);
      const newPath = normalizeRepoPath(parts[index++]);
      counts.set(changedFileKey(newPath, oldPath), { additions, deletions });
      continue;
    }

    const pathValue = normalizeRepoPath(fields.slice(2).join("\t"));
    counts.set(changedFileKey(pathValue), { additions, deletions });
  }

  return counts;
}

function statusFromGitCode(code) {
  if (code.startsWith("A")) {
    return "added";
  }
  if (code.startsWith("D")) {
    return "deleted";
  }
  if (code.startsWith("R")) {
    return "renamed";
  }
  return "modified";
}

function parseStatNumber(value) {
  return /^\d+$/.test(value) ? Number(value) : null;
}

function collectUntrackedFiles(repo, provenance) {
  const result = runGit(["ls-files", "--others", "--exclude-standard", "-z"], {
    cwd: repo.root,
    provenance,
  });

  if (!result.ok) {
    return [];
  }

  return splitNul(result.stdout)
    .map((pathValue) => normalizeRepoPath(pathValue))
    .filter((pathValue) => !isExcludedRepoPath(pathValue))
    .map((pathValue) =>
      buildChangedFile({
        path: pathValue,
        status: "untracked",
        additions: null,
        deletions: null,
        isUntracked: true,
      })
    );
}

function buildChangedFile({ path: filePath, oldPath, status, additions, deletions, isUntracked }) {
  const extension = path.posix.extname(filePath);
  const isTest = isTestPath(filePath);
  const isDoc = isDocPath(filePath);
  const record = {
    path: filePath,
    status,
    additions,
    deletions,
    extension,
    surface: classifySurface(filePath, { isDoc, isTest }),
    isDoc,
    isTest,
    isUntracked,
  };

  if (oldPath) {
    record.oldPath = oldPath;
  }

  return record;
}

function isDocPath(filePath) {
  const extension = path.posix.extname(filePath).toLowerCase();
  return (
    filePath.startsWith("docs/") ||
    [".md", ".mdx", ".rst", ".txt", ".adoc"].includes(extension)
  );
}

function isTestPath(filePath) {
  return (
    /(^|\/)(__tests__|tests?|spec)(\/|$)/i.test(filePath) ||
    /\.(test|spec)\.[^/]+$/i.test(filePath)
  );
}

function classifySurface(filePath, { isDoc, isTest }) {
  if (isTest) {
    return "test";
  }
  if (isDoc || filePath.startsWith("docs/")) {
    return "docs";
  }
  if (/^(src|lib|bin|scripts)\//.test(filePath)) {
    return "source";
  }
  if (
    filePath.startsWith(".github/") ||
    /(^|\/)(package.json|package-lock.json|tsconfig.json|jsconfig.json|Cargo.toml|pyproject.toml|go.mod)$/.test(
      filePath
    )
  ) {
    return "config";
  }
  if (!filePath.includes("/")) {
    return "root";
  }
  return "other";
}

function mergeChangedRecords(records, incoming) {
  for (const record of incoming) {
    const key = changedFileKey(record.path, record.oldPath);
    const existingKey = records.has(key)
      ? key
      : findChangedRecordKeyByPath(records, record.path);

    if (!existingKey) {
      records.set(key, record);
      continue;
    }

    const merged = mergeChangedFile(records.get(existingKey), record);
    const mergedKey = changedFileKey(merged.path, merged.oldPath);
    if (mergedKey !== existingKey) {
      records.delete(existingKey);
    }
    records.set(mergedKey, merged);
  }
}

function findChangedRecordKeyByPath(records, filePath) {
  for (const [key, record] of records.entries()) {
    if (record.path === filePath) {
      return key;
    }
  }
  return null;
}

function mergeChangedFile(left, right) {
  return {
    ...left,
    ...right,
    status: mergeStatus(left.status, right.status),
    additions: addNullableStats(left.additions, right.additions),
    deletions: addNullableStats(left.deletions, right.deletions),
    isUntracked: left.isUntracked && right.isUntracked,
  };
}

function mergeStatus(left, right) {
  const rank = new Map([
    ["deleted", 4],
    ["renamed", 3],
    ["added", 2],
    ["modified", 1],
    ["untracked", 0],
  ]);

  return (rank.get(right) || 0) > (rank.get(left) || 0) ? right : left;
}

function addNullableStats(left, right) {
  if (left === null && right === null) {
    return null;
  }
  return (left || 0) + (right || 0);
}

function compareChangedFiles(left, right) {
  return (
    left.path.localeCompare(right.path) ||
    (left.oldPath || "").localeCompare(right.oldPath || "") ||
    left.status.localeCompare(right.status)
  );
}

function changedFileKey(filePath, oldPath = "") {
  return `${oldPath || ""}\u0000${filePath}`;
}

function splitNul(value) {
  const parts = value.split("\0");
  if (parts[parts.length - 1] === "") {
    parts.pop();
  }
  return parts;
}

function normalizeRepoPath(value) {
  return toPosix(value || "").replace(/^\.\//, "");
}

function isExcludedRepoPath(value) {
  const normalized = normalizeRepoPath(value);
  if (
    !normalized ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized.includes("/../")
  ) {
    return true;
  }

  if (isExcludedBeadsRuntimePath(normalized)) {
    return true;
  }

  return EXCLUDED_REPO_PATHS.some(
    (excludedPath) =>
      normalized === excludedPath || normalized.startsWith(`${excludedPath}/`)
  );
}

function isExcludedBeadsRuntimePath(normalized) {
  if (!normalized.startsWith(".beads/")) {
    return false;
  }

  if (normalized.startsWith(".beads/.br_history/")) {
    return true;
  }

  const basename = path.posix.basename(normalized);
  return (
    basename === "last-touched" ||
    basename.endsWith(".db") ||
    basename.endsWith(".db-wal") ||
    basename.endsWith(".db-shm") ||
    basename.endsWith(".lock")
  );
}

function collectChangedIdentifiers(repo, comparison, changedFiles, provenance) {
  const identifiers = [];

  if (repo.isGit) {
    for (const source of collectChangedLineSources(repo, comparison, provenance)) {
      addIdentifiersFromText(identifiers, source.text, {
        sourcePath: source.sourcePath,
        source: "changed_line",
      });
    }
  }

  for (const file of changedFiles) {
    if (file.status !== "untracked" || isExcludedRepoPath(file.path)) {
      continue;
    }

    const text = readSmallTextFile(path.join(repo.root, file.path));
    if (text === null) {
      continue;
    }

    addIdentifiersFromText(identifiers, text, {
      sourcePath: file.path,
      source: "changed_file",
    });
  }

  return dedupeAndSortIdentifiers(identifiers);
}

function collectChangedLineSources(repo, comparison, provenance) {
  if (comparison.strategy === "worktree") {
    return [
      ...collectChangedLineSourcesFromGit(repo, provenance, [
        "diff",
        "--unified=0",
        "--no-ext-diff",
      ]),
      ...collectChangedLineSourcesFromGit(repo, provenance, [
        "diff",
        "--cached",
        "--unified=0",
        "--no-ext-diff",
      ]),
    ];
  }

  if (comparison.strategy === "root_commit") {
    return collectChangedLineSourcesFromGit(repo, provenance, [
      "show",
      "--format=",
      "--unified=0",
      "--no-ext-diff",
      "HEAD",
    ]);
  }

  if (!comparison.range) {
    return [];
  }

  return collectChangedLineSourcesFromGit(repo, provenance, [
    "diff",
    "--unified=0",
    "--no-ext-diff",
    comparison.mergeBase || comparison.range,
  ]);
}

function collectChangedLineSourcesFromGit(repo, provenance, args) {
  const result = runGit(args, { cwd: repo.root, provenance });
  if (!result.ok) {
    return [];
  }

  return parseChangedLineSources(result.stdout);
}

function parseChangedLineSources(diffText) {
  const sources = [];
  let oldPath = null;
  let newPath = null;

  for (const line of diffText.split("\n")) {
    if (line.startsWith("--- ")) {
      oldPath = parseDiffPath(line.slice(4), "a/");
      continue;
    }
    if (line.startsWith("+++ ")) {
      newPath = parseDiffPath(line.slice(4), "b/");
      continue;
    }
    if (line.startsWith("+++") || line.startsWith("---")) {
      continue;
    }
    if (!line.startsWith("+") && !line.startsWith("-")) {
      continue;
    }

    const sourcePath = newPath || oldPath;
    if (!sourcePath || isExcludedRepoPath(sourcePath)) {
      continue;
    }

    sources.push({
      sourcePath,
      text: line.slice(1),
    });
  }

  return sources;
}

function parseDiffPath(value, prefix) {
  const token = value.trim();
  if (token === "/dev/null") {
    return null;
  }

  if (token.startsWith(prefix)) {
    return normalizeRepoPath(token.slice(prefix.length));
  }

  return normalizeRepoPath(token);
}

function readSmallTextFile(filePath) {
  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch {
    return null;
  }

  if (!stat.isFile() || stat.size > WHOLE_FILE_IDENTIFIER_READ_LIMIT) {
    return null;
  }

  const buffer = fs.readFileSync(filePath);
  if (buffer.includes(0)) {
    return null;
  }

  return buffer.toString("utf8");
}

function addIdentifiersFromText(identifiers, text, { sourcePath, source }) {
  addMatches(identifiers, text, /\b[A-Z][A-Z0-9_]{2,}\b/g, "env_var", {
    sourcePath,
    source,
  });
  addMatches(identifiers, text, /--[a-z][a-z0-9-]*/gi, "cli_flag", {
    sourcePath,
    source,
  });
  addMatches(
    identifiers,
    text,
    /(?:^|[\s"'`])([A-Za-z0-9._-]+\/[A-Za-z0-9._/\-]*[A-Za-z0-9_-](?:\.[A-Za-z0-9]+)?)/g,
    "path",
    { sourcePath, source },
    1
  );

  if (sourcePath === "package.json") {
    addMatches(
      identifiers,
      text,
      /"([A-Za-z0-9:_-]+)"\s*:/g,
      "npm_script",
      { sourcePath, source },
      1
    );
  }

  addMatches(
    identifiers,
    text,
    /\b(?:function|class|const|let|var)\s+([A-Za-z_$][\w$]*)/g,
    "js_identifier",
    { sourcePath, source },
    1,
    (value) => !isCommonJsIdentifier(value)
  );
}

function addMatches(
  identifiers,
  text,
  pattern,
  kind,
  { sourcePath, source },
  group = 0,
  predicate = () => true
) {
  for (const match of text.matchAll(pattern)) {
    const value = match[group];
    if (!value || !predicate(value)) {
      continue;
    }
    identifiers.push({ value, kind, sourcePath, source });
  }
}

function isCommonJsIdentifier(value) {
  return new Set([
    "if",
    "for",
    "while",
    "switch",
    "return",
    "const",
    "let",
    "var",
    "function",
    "class",
  ]).has(value);
}

function dedupeAndSortIdentifiers(identifiers) {
  const deduped = new Map();
  for (const identifier of identifiers) {
    const key = [
      identifier.value,
      identifier.kind,
      identifier.sourcePath,
      identifier.source,
    ].join("\u0000");
    deduped.set(key, identifier);
  }

  return [...deduped.values()].sort(
    (left, right) =>
      left.sourcePath.localeCompare(right.sourcePath) ||
      left.value.localeCompare(right.value) ||
      left.kind.localeCompare(right.kind) ||
      left.source.localeCompare(right.source)
  );
}

function collectLocalArtifacts(repo, changedFiles) {
  const artifacts = [];
  const changedPaths = new Set();
  for (const file of changedFiles) {
    changedPaths.add(file.path);
    if (file.oldPath) {
      changedPaths.add(file.oldPath);
    }
  }

  walkRepoFiles(repo.root, (absolutePath, relativePath) => {
    if (!isLocalArtifactCandidate(relativePath)) {
      return;
    }

    const stat = fs.statSync(absolutePath);
    const metadata = readArtifactMetadata(absolutePath, relativePath);
    artifacts.push({
      path: relativePath,
      kind: artifactKind(relativePath),
      title: metadata.title,
      createdAt: null,
      modifiedAt: stat.mtime.toISOString(),
      changedInComparison: changedPaths.has(relativePath),
      sizeBytes: stat.size,
      headings: metadata.headings,
    });
  });

  return artifacts.sort((left, right) => left.path.localeCompare(right.path));
}

function walkRepoFiles(root, visit, directory = root) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = normalizeRepoPath(path.relative(root, absolutePath));

    if (isExcludedRepoPath(relativePath)) {
      continue;
    }

    if (entry.isDirectory()) {
      walkRepoFiles(root, visit, absolutePath);
    } else if (entry.isFile()) {
      visit(absolutePath, relativePath);
    }
  }
}

function isLocalArtifactCandidate(relativePath) {
  const lower = relativePath.toLowerCase();
  const extension = path.posix.extname(lower);
  return (
    [".md", ".mdx", ".html", ".htm"].includes(extension) ||
    /(^|\/)(plans?|investigations?|design|reports?)(\/|$)/.test(lower) ||
    /(plan|investigation|design|report|audit)/.test(path.posix.basename(lower))
  );
}

function artifactKind(relativePath) {
  const lower = relativePath.toLowerCase();
  const basename = path.posix.basename(lower);
  const extension = path.posix.extname(lower);

  if (extension === ".html" || extension === ".htm") {
    return "html";
  }
  if (/(^|\/)plans?(\/|$)/.test(lower) || basename.includes("plan")) {
    return "plan";
  }
  if (basename.includes("investigation") || lower.includes("/investigations/")) {
    return "investigation";
  }
  if (basename.includes("design") || lower.includes("/design")) {
    return "design";
  }
  if (basename.includes("report") || basename.includes("audit") || lower.includes("/reports/")) {
    return "report";
  }
  if (extension === ".md" || extension === ".mdx") {
    return "doc";
  }
  return "other";
}

function readArtifactMetadata(absolutePath, relativePath) {
  const extension = path.posix.extname(relativePath).toLowerCase();
  const text = readSmallTextFile(absolutePath) || "";

  if (extension === ".html" || extension === ".htm") {
    return {
      title: extractHtmlTitle(text),
      headings: [],
    };
  }

  return extractMarkdownMetadata(text);
}

function extractMarkdownMetadata(text) {
  const headings = [];
  for (const line of text.split("\n")) {
    const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!match) {
      continue;
    }
    headings.push(match[2].trim());
    if (headings.length >= 20) {
      break;
    }
  }

  const title = headings[0] || null;
  return { title, headings };
}

function extractHtmlTitle(text) {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(text);
  return match ? normalizeWhitespace(stripHtml(match[1])) : null;
}

function stripHtml(value) {
  return value.replace(/<[^>]+>/g, "");
}

function normalizeWhitespace(value) {
  return value.replace(/\s+/g, " ").trim();
}

function collectVerification(repo, changedFiles) {
  const commandsDiscovered = discoverVerificationCommands(repo.root);
  return {
    testsChanged: changedFiles
      .filter((file) => file.isTest)
      .map((file) => file.path)
      .sort(),
    commandsDiscovered,
    commandsRun: [],
    notRun: [...commandsDiscovered],
  };
}

function discoverVerificationCommands(repoRoot) {
  const packagePath = path.join(repoRoot, "package.json");
  let stat;
  try {
    stat = fs.statSync(packagePath);
  } catch {
    return [];
  }

  if (!stat.isFile() || stat.size > 512 * 1024) {
    return [];
  }

  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(packagePath, "utf8"));
  } catch {
    return [];
  }

  const scripts = parsed && typeof parsed.scripts === "object" ? parsed.scripts : null;
  if (!scripts) {
    return [];
  }

  return Object.keys(scripts)
    .filter(isVerificationScriptName)
    .map((scriptName) => (scriptName === "test" ? "npm test" : `npm run ${scriptName}`))
    .sort();
}

function isVerificationScriptName(scriptName) {
  return /^(check|test(?::.+)?|lint(?::.+)?|typecheck|type-check)$/.test(
    scriptName
  );
}

function computeMetrics(changedFiles, changedIdentifiers, localArtifacts) {
  return {
    filesChanged: changedFiles.length,
    additions: sumFileStat(changedFiles, "additions"),
    deletions: sumFileStat(changedFiles, "deletions"),
    trackedFilesChanged: changedFiles.filter((file) => !file.isUntracked).length,
    untrackedFiles: changedFiles.filter((file) => file.isUntracked).length,
    deletedFiles: changedFiles.filter((file) => file.status === "deleted").length,
    renamedFiles: changedFiles.filter((file) => file.status === "renamed").length,
    docsFilesChanged: changedFiles.filter((file) => file.surface === "docs").length,
    sourceFilesChanged: changedFiles.filter((file) => file.surface === "source").length,
    testFilesChanged: changedFiles.filter((file) => file.isTest).length,
    localArtifactsFound: localArtifacts.length,
    htmlArtifactsFound: localArtifacts.filter((artifact) => artifact.kind === "html").length,
    identifierCount: changedIdentifiers.length,
  };
}

function sumFileStat(changedFiles, key) {
  return changedFiles.reduce(
    (sum, file) => sum + (typeof file[key] === "number" ? file[key] : 0),
    0
  );
}

function collectRepoInventory(repo, changedFiles) {
  const files = [];
  walkRepoFiles(repo.root, (_absolutePath, relativePath) => {
    files.push(relativePath);
  });
  files.sort();

  return {
    topLevelEntries: collectTopLevelEntries(repo.root),
    fileCountsByExtension: countFilesByExtension(files),
    knownManifests: files.filter(isKnownManifest).sort(),
    knownWorkflowFiles: files
      .filter((filePath) => filePath.startsWith(".github/workflows/"))
      .sort(),
    changedFilesByTopLevel: countChangedFilesByTopLevel(changedFiles),
    largestChangedFiles: largestChangedFiles(changedFiles),
  };
}

function collectTopLevelEntries(root) {
  const entries = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const relativePath = normalizeRepoPath(entry.name);
    if (isExcludedRepoPath(relativePath)) {
      continue;
    }
    if (entry.isDirectory() && !hasIncludedDescendant(path.join(root, entry.name), root)) {
      continue;
    }
    if (!entry.isDirectory() && !entry.isFile()) {
      continue;
    }
    entries.push({
      name: relativePath,
      type: entry.isDirectory() ? "directory" : "file",
    });
  }

  return entries.sort((left, right) => left.name.localeCompare(right.name));
}

function hasIncludedDescendant(directory, root) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolutePath = path.join(directory, entry.name);
    const relativePath = normalizeRepoPath(path.relative(root, absolutePath));
    if (isExcludedRepoPath(relativePath)) {
      continue;
    }
    if (entry.isFile()) {
      return true;
    }
    if (entry.isDirectory() && hasIncludedDescendant(absolutePath, root)) {
      return true;
    }
  }
  return false;
}

function countFilesByExtension(files) {
  const counts = new Map();
  for (const file of files) {
    const extension = path.posix.extname(file).toLowerCase() || "(none)";
    counts.set(extension, (counts.get(extension) || 0) + 1);
  }
  return sortedObject(counts);
}

function isKnownManifest(filePath) {
  return new Set([
    "package.json",
    "package-lock.json",
    "Cargo.toml",
    "pyproject.toml",
    "go.mod",
    "Gemfile",
  ]).has(path.posix.basename(filePath));
}

function countChangedFilesByTopLevel(changedFiles) {
  const counts = new Map();
  for (const file of changedFiles) {
    const bucket = file.path.includes("/") ? file.path.split("/")[0] : "root";
    counts.set(bucket, (counts.get(bucket) || 0) + 1);
  }
  return sortedObject(counts);
}

function largestChangedFiles(changedFiles) {
  return changedFiles
    .filter(
      (file) =>
        typeof file.additions === "number" || typeof file.deletions === "number"
    )
    .map((file) => ({
      path: file.path,
      additions: typeof file.additions === "number" ? file.additions : 0,
      deletions: typeof file.deletions === "number" ? file.deletions : 0,
      totalChanges:
        (typeof file.additions === "number" ? file.additions : 0) +
        (typeof file.deletions === "number" ? file.deletions : 0),
    }))
    .sort(
      (left, right) =>
        right.totalChanges - left.totalChanges || left.path.localeCompare(right.path)
    )
    .slice(0, 10);
}

function collectChangedSurfaces(changedFiles) {
  const surfaces = new Map();
  for (const file of changedFiles) {
    const surface = surfaces.get(file.surface) || {
      surface: file.surface,
      count: 0,
      additions: 0,
      deletions: 0,
      files: [],
    };
    surface.count += 1;
    surface.additions += typeof file.additions === "number" ? file.additions : 0;
    surface.deletions += typeof file.deletions === "number" ? file.deletions : 0;
    surface.files.push(file.path);
    surfaces.set(file.surface, surface);
  }

  return [...surfaces.values()]
    .map((surface) => ({
      ...surface,
      files: surface.files.sort(),
    }))
    .sort((left, right) => left.surface.localeCompare(right.surface));
}

function sortedObject(map) {
  return Object.fromEntries([...map.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function resolveWorkstream(repo, provenance) {
  if (!repo.isGit) {
    return "current";
  }

  const result = runGit(["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: repo.root,
    provenance,
  });

  if (!result.ok) {
    return "current";
  }

  const branch = result.stdout.trim();
  if (!branch) {
    return "current";
  }

  if (branch === "HEAD") {
    const shortSha = runGit(["rev-parse", "--short", "HEAD"], {
      cwd: repo.root,
      provenance,
    });
    const value = shortSha.stdout.trim();
    return shortSha.ok && value ? `detached-${value}` : "current";
  }

  const head = runGit(["rev-parse", "--verify", "HEAD"], {
    cwd: repo.root,
    provenance,
  });
  if (!head.ok) {
    return "current";
  }

  return sanitizeWorkstream(branch);
}

function sanitizeWorkstream(value) {
  const sanitized = value
    .replace(/[^A-Za-z0-9._-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");

  return sanitized || "current";
}

function emptyActionableDiff({
  repoRoot,
  comparison,
  provenance,
  metrics,
  repoInventory,
  changedFiles,
  changedSurfaces,
  changedIdentifiers,
  localArtifacts,
  verification,
}) {
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    repo: {
      root: repoRoot,
      name: path.basename(repoRoot),
    },
    comparison,
    provenance,
    metrics,
    repoInventory,
    changedFiles,
    changedSurfaces,
    changedIdentifiers,
    localArtifacts,
    verification,
  };
}

function writeJsonAtomic(outputPath, value) {
  const outputDir = path.dirname(outputPath);
  fs.mkdirSync(outputDir, { recursive: true });

  const tempPath = path.join(
    outputDir,
    `.philip-diff-${process.pid}-${Date.now()}.tmp`
  );

  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`);
    fs.renameSync(tempPath, outputPath);
  } catch (error) {
    fs.rmSync(tempPath, { force: true });
    throw error;
  }
}

function toPosix(value) {
  return value.split(path.sep).join(path.posix.sep);
}

main();
