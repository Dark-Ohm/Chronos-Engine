#!/usr/bin/env node

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const philipBin = path.join(root, "bin", "philip.js");

test("philip help can show command-specific help", () => {
  const result = runPhilip(["help", "diff"], { cwd: root });

  assert.equal(result.status, 0, formatResult(result));
  assert.match(result.stdout, /^Usage:\n  philip diff/m);
  assert.match(result.stdout, /--json/);
  assert.equal(result.stderr, "");
});

test("philip install --help shows install-specific help", () => {
  const result = runPhilip(["install", "--help"], { cwd: root });

  assert.equal(result.status, 0, formatResult(result));
  assert.match(result.stdout, /^Usage:\n  philip install/m);
  assert.match(result.stdout, /--dry-run/);
  assert.equal(result.stderr, "");
});

test("philip install rejects unknown flags before filesystem writes", () => {
  const result = runPhilip(["install", "--bad"], { cwd: root });

  assert.equal(result.status, 2, formatResult(result));
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Unknown option: --bad/);
  assert.match(result.stderr, /philip install --help/);
});

test("philip diff --help shows help without writing an artifact", (t) => {
  const repo = makeTempRepo(t);
  writeFile(repo, "README.md", "# Example\n");
  commitAll(repo, "Initial commit");

  const result = runPhilip(["diff", "--help"], { cwd: repo.root });

  assert.equal(result.status, 0, formatResult(result));
  assert.match(result.stdout, /^Usage:\n  philip diff/m);
  assert.equal(result.stderr, "");
  assert.equal(
    fs.existsSync(path.join(repo.root, ".philip", "artifacts")),
    false,
    "help must not write generated artifacts"
  );
});

test("philip diff rejects unknown flags and does not write an artifact", (t) => {
  const repo = makeTempRepo(t);
  writeFile(repo, "README.md", "# Example\n");
  commitAll(repo, "Initial commit");

  const result = runPhilip(["diff", "--bad"], { cwd: repo.root });

  assert.equal(result.status, 2, formatResult(result));
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Unknown option: --bad/);
  assert.match(result.stderr, /philip diff --help/);
  assert.equal(
    fs.existsSync(path.join(repo.root, ".philip", "artifacts")),
    false,
    "invalid options must not write generated artifacts"
  );
});

test("philip diff --json prints a parseable result envelope", (t) => {
  const repo = makeTempRepo(t);
  writeFile(repo, "README.md", "# Example\n");
  commitAll(repo, "Initial commit");
  writeFile(repo, "README.md", "# Example\n\nChanged.\n");

  const result = runPhilip(["diff", "--json"], { cwd: repo.root });

  assert.equal(result.status, 0, formatResult(result));
  assert.equal(result.stderr, "");

  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, true);
  assert.equal(parsed.artifact.kind, "actionable_diff");
  assert.equal(parsed.artifact.path, ".philip/artifacts/main/philip-diff.json");
  assert.equal(parsed.artifact.schemaVersion, 1);
  assert.equal(typeof parsed.metrics.filesChanged, "number");
});

test("lint-audit rejects invalid Confidence labels", (t) => {
  const repo = makeTempDir(t);
  const fixture = fs.readFileSync(
    path.join(root, "fixtures", "audit-lint", "pass.md"),
    "utf8"
  );
  const auditPath = writeFile(
    repo,
    "invalid-confidence.md",
    fixture.replace("Confidence: High.", "Confidence: Banana.")
  );

  const result = runPhilip(["lint-audit", auditPath, "--json"], { cwd: repo.root });

  assert.equal(result.status, 1, formatResult(result));
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.ok, false);
  assert.ok(
    parsed.issues.some((issue) => issue.code === "INVALID_CONFIDENCE_LABEL"),
    "expected INVALID_CONFIDENCE_LABEL issue"
  );
  assert.equal(result.stderr, "");
});

test("capabilities --json is machine-readable and data-only", () => {
  const result = runPhilip(["capabilities", "--json"], { cwd: root });

  assert.equal(result.status, 0, formatResult(result));
  assert.equal(result.stderr, "");
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.tool, "philip");
  assert.ok(Array.isArray(parsed.commands));
  assert.ok(parsed.commands.some((command) => command.name === "diff"));
  assert.equal(parsed.exitCodes["2"], "user-input-error");
});

test("robot-docs guide prints the agent quick guide", () => {
  const result = runPhilip(["robot-docs", "guide"], { cwd: root });

  assert.equal(result.status, 0, formatResult(result));
  assert.match(result.stdout, /^# Philip Agent Quick Guide/m);
  assert.match(result.stdout, /philip diff --json/);
  assert.equal(result.stderr, "");
});

test("robot triage prints one parseable JSON object without writing artifacts", (t) => {
  const repo = makeTempRepo(t);
  writeFile(repo, "README.md", "# Example\n");
  commitAll(repo, "Initial commit");

  const beforeArtifacts = path.join(repo.root, ".philip", "artifacts");
  const result = runPhilip(["--robot-triage"], { cwd: repo.root });

  assert.equal(result.status, 0, formatResult(result));
  assert.equal(result.stderr, "");
  assert.equal(
    fs.existsSync(beforeArtifacts),
    false,
    "robot triage must not create the artifact store"
  );

  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.tool, "philip");
  assert.equal(parsed.contractVersion, 2);
  assert.equal(parsed.invocation, "philip --robot-triage");
  assert.ok(Array.isArray(parsed.commands));
  assert.ok(parsed.commands.some((command) => command.name === "diff"));
  assert.ok(Array.isArray(parsed.structuredSurfaces));
  assert.equal(parsed.artifactStore.path, ".philip/artifacts");
  assert.equal(parsed.artifactStore.exists, false);
  assert.equal(parsed.currentDiffArtifactPath, null);
  assert.equal(parsed.latestDiffArtifactPath, null);
  assert.ok(parsed.verification.commandsDiscovered.includes("npm run check"));
  assert.deepEqual(parsed.verification.commandsRun, []);
  assert.ok(
    parsed.recommendedNextCommands.some((entry) => entry.command === "philip diff --json")
  );
  assert.equal(parsed.exitCodes["2"], "user-input-error");
});

test("robot triage reports current and latest diff artifacts when present", (t) => {
  const repo = makeTempRepo(t);
  writeFile(repo, "README.md", "# Example\n");
  commitAll(repo, "Initial commit");
  writeFile(
    repo,
    ".philip/artifacts/main/philip-diff.json",
    JSON.stringify({
      verification: {
        commandsDiscovered: ["npm run custom"],
        commandsRun: ["npm run old"],
      },
    })
  );

  const result = runPhilip(["--robot-triage"], { cwd: repo.root });

  assert.equal(result.status, 0, formatResult(result));
  assert.equal(result.stderr, "");
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.artifactStore.exists, true);
  assert.equal(parsed.artifactStore.currentWorkstream, "main");
  assert.equal(
    parsed.currentDiffArtifactPath,
    ".philip/artifacts/main/philip-diff.json"
  );
  assert.equal(parsed.latestDiffArtifactPath, ".philip/artifacts/main/philip-diff.json");
  assert.ok(parsed.verification.commandsDiscovered.includes("npm run custom"));
  assert.deepEqual(parsed.verification.commandsRun, []);
});

test("robot triage rejects unknown flags with corrective stderr", () => {
  const result = runPhilip(["--robot-triage", "--bad"], { cwd: root });

  assert.equal(result.status, 2, formatResult(result));
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Unknown option: --bad/);
  assert.match(result.stderr, /philip --robot-triage/);
});

test("unknown top-level commands teach the nearest command", () => {
  const result = runPhilip(["dif"], { cwd: root });

  assert.equal(result.status, 2, formatResult(result));
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Unknown command: dif/);
  assert.match(result.stderr, /Did you mean `philip diff`/);
});

test("common --json typo gets a specific correction", () => {
  const result = runPhilip(["lint-audit", "fixtures/audit-lint/pass.md", "--jsno"], {
    cwd: root,
  });

  assert.equal(result.status, 2, formatResult(result));
  assert.equal(result.stdout, "");
  assert.match(result.stderr, /Unknown option: --jsno/);
  assert.match(result.stderr, /Did you mean `--json`/);
});

function makeTempRepo(t) {
  const repo = makeTempDir(t);

  const init = git(repo, ["init", "-b", "main"], { allowFailure: true });
  if (init.status !== 0) {
    git(repo, ["init"]);
    git(repo, ["checkout", "-B", "main"]);
  }

  git(repo, ["config", "user.name", "Philip Test"]);
  git(repo, ["config", "user.email", "philip@example.invalid"]);

  return repo;
}

function makeTempDir(t) {
  const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "philip-cli-"));
  const repo = { root: rootPath };
  t.after(() => fs.rmSync(rootPath, { recursive: true, force: true }));
  return repo;
}

function git(repo, args, options = {}) {
  const result = runCommand("git", args, { cwd: repo.root });
  if (!options.allowFailure) {
    assert.equal(result.status, 0, formatResult(result));
  }
  return result;
}

function commitAll(repo, message) {
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", message]);
}

function writeFile(repo, relativePath, contents) {
  const absolutePath = path.join(repo.root, relativePath);
  fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
  fs.writeFileSync(absolutePath, contents);
  return absolutePath;
}

function runPhilip(args, options = {}) {
  return runCommand(process.execPath, [philipBin, ...args], options);
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

function formatResult(result) {
  return [
    `command: ${result.command}`,
    `cwd: ${result.cwd}`,
    `status: ${result.status}`,
    `stdout:\n${result.stdout}`,
    `stderr:\n${result.stderr}`,
    result.error ? `error: ${result.error.message}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}
