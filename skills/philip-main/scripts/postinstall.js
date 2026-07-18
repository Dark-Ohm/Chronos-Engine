#!/usr/bin/env node

"use strict";

const { spawnSync } = require("node:child_process");
const { closeSync, openSync, writeSync } = require("node:fs");
const path = require("node:path");

const autoInstall =
  process.env.PHILIP_AUTO_INSTALL === "1" ||
  process.env.PHILIP_AUTO_INSTALL === "true";

if (autoInstall) {
  const installer = path.resolve(__dirname, "..", "bin", "philip.js");
  const result = spawnSync(process.execPath, [installer, "install"], {
    encoding: "utf8",
  });

  const output = [result.stdout, result.stderr].filter(Boolean).join("");
  writeNotice(output || "Philip install finished.\n");

  if (result.status && result.status !== 0) {
    writeNotice(
      "Philip package installation completed, but the skill copy step did not. " +
        "Run `philip install --force` if you want to replace an existing install.\n"
    );
  }
} else {
  writeNotice(`Philip installed.

Next step:
  philip install

That copies the skill to ~/.agents/skills/philip.
For a repo-local install, run:
  philip install --project

For the broader Agent Skills installer, use:
  npx skills@latest add benvenker/philip

For a one-command global install, use:
  PHILIP_AUTO_INSTALL=1 npm install -g @benvenker/philip
`);
}

function writeNotice(message) {
  if (process.env.CI) {
    process.stderr.write(message);
    return;
  }

  try {
    const tty = openSync("/dev/tty", "w");
    try {
      writeSync(tty, message);
    } finally {
      closeSync(tty);
    }
  } catch {
    process.stderr.write(message);
  }
}
