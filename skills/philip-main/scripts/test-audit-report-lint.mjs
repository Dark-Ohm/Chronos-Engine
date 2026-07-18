#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const validator = path.join(root, "scripts", "audit-report-lint.mjs");
const fixtures = path.join(root, "fixtures", "audit-lint");

const cases = [
  {
    name: "passing audit",
    file: "pass.md",
    format: "audit",
    expectStatus: 0,
  },
  {
    name: "missing coverage map",
    file: "fail-missing-coverage-map.md",
    format: "audit",
    expectStatus: 1,
    expectCode: "MISSING_SECTION",
  },
  {
    name: "missing finding fields",
    file: "fail-missing-finding-fields.md",
    format: "audit",
    expectStatus: 1,
    expectCode: "MISSING_FINDING_FIELD",
  },
  {
    name: "invalid verification label",
    file: "fail-invalid-verification-label.md",
    format: "audit",
    expectStatus: 1,
    expectCode: "INVALID_VERIFICATION_LABEL",
  },
  {
    name: "invalid confidence label",
    file: "fail-invalid-confidence-label.md",
    format: "audit",
    expectStatus: 1,
    expectCode: "INVALID_CONFIDENCE_LABEL",
  },
  {
    name: "plan checklist before audit",
    file: "fail-plan-checklist-before-audit.md",
    format: "plan",
    expectStatus: 1,
    expectCode: "PLAN_CHECKLIST_BEFORE_AUDIT",
  },
];

let failures = 0;

for (const testCase of cases) {
  const result = spawnSync(
    process.execPath,
    [
      validator,
      "--json",
      "--format",
      testCase.format,
      path.join(fixtures, testCase.file),
    ],
    { encoding: "utf8" }
  );

  const passedStatus =
    testCase.expectStatus === 0 ? result.status === 0 : result.status !== 0;
  let parsed;

  try {
    parsed = JSON.parse(result.stdout);
  } catch (error) {
    reportFailure(testCase, `validator did not return JSON: ${error.message}`);
    continue;
  }

  const hasExpectedCode =
    !testCase.expectCode ||
    parsed.issues.some((issue) => issue.code === testCase.expectCode);

  if (!passedStatus) {
    reportFailure(
      testCase,
      `expected ${
        testCase.expectStatus === 0 ? "success" : "failure"
      }, got exit ${result.status}`
    );
    continue;
  }

  if (!hasExpectedCode) {
    reportFailure(testCase, `missing expected issue ${testCase.expectCode}`);
    continue;
  }

  process.stdout.write(`PASS ${testCase.name}\n`);
}

if (failures > 0) {
  process.exitCode = 1;
}

function reportFailure(testCase, message) {
  failures += 1;
  process.stderr.write(`FAIL ${testCase.name}: ${message}\n`);
}
