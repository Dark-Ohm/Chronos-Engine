#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

const REQUIRED_SECTIONS = [
  "Executive Summary",
  "Findings",
  "Coverage Map",
  "Recommended Plan",
  "Unknowns",
  "Verification Notes",
];
const SEVERITIES = ["Critical", "High", "Medium", "Low"];
const FINDING_FIELDS = [
  "Problem",
  "Evidence",
  "Impact",
  "Fix",
  "Verification",
  "Confidence",
];
const VERIFICATION_LABELS = [
  "verified",
  "not run",
  "not found",
  "partially verified",
];
const CONFIDENCE_LABELS = ["high", "medium", "low"];
const STRUCTURE_WARNING =
  "Structural pass only: audit-report-lint checks report shape, not whether cited evidence is factually true.";
const FIELD_NAMES = FINDING_FIELDS.map((field) => field.toLowerCase());
const SECTION_ALIASES = new Map([
  ["executive summary", "Executive Summary"],
  ["summary", "Executive Summary"],
  ["findings", "Findings"],
  ["audit findings", "Findings"],
  ["coverage map", "Coverage Map"],
  ["coverage", "Coverage Map"],
  ["recommended plan", "Recommended Plan"],
  ["recommendations", "Recommended Plan"],
  ["plan", "Recommended Plan"],
  ["unknowns", "Unknowns"],
  ["open questions", "Unknowns"],
  ["verification notes", "Verification Notes"],
  ["verification", "Verification Notes"],
]);

function main() {
  const options = parseArgs(process.argv.slice(2));
  const markdown = readInput(options.file);
  const result = lint(markdown, options);

  if (options.json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } else {
    printPlain(result, options.file);
  }

  if (result.issues.some((issue) => issue.severity === "error")) {
    process.exitCode = 1;
  }
}

function parseArgs(argv) {
  const options = {
    file: null,
    json: false,
    format: "auto",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--format") {
      const value = argv[index + 1];
      if (!value) {
        fail("--format requires audit, plan, or auto");
      }
      options.format = value;
      index += 1;
    } else if (arg.startsWith("--format=")) {
      options.format = arg.slice("--format=".length);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (arg.startsWith("-") && arg !== "-") {
      fail(`Unknown option: ${arg}`);
    } else if (!options.file) {
      options.file = arg;
    } else {
      fail(`Unexpected argument: ${arg}`);
    }
  }

  if (!["audit", "plan", "auto"].includes(options.format)) {
    fail("--format must be audit, plan, or auto");
  }

  if (!options.file) {
    fail("Expected an audit report path or '-' for stdin");
  }

  return options;
}

function printHelp() {
  process.stdout.write(`Usage:
  audit-report-lint.mjs [--json] [--format audit|plan|auto] <file|->

Checks Philip documentation audit reports for required structure. The linter is
dependency-free and does not verify whether cited evidence is true.
`);
}

function fail(message) {
  process.stderr.write(`audit-report-lint: ${message}\n`);
  process.exit(2);
}

function readInput(file) {
  if (file === "-") {
    return fs.readFileSync(0, "utf8");
  }

  return fs.readFileSync(path.resolve(file), "utf8");
}

function lint(markdown, options) {
  const body = stripFrontmatter(markdown);
  const headings = parseHeadings(body);
  const sections = findSections(body, headings);
  const format = resolveFormat(body, options.format);
  const issues = [];

  validateRequiredSections(sections, issues);
  validateFindings(sections, issues);
  validateCoverageMap(sections, issues);
  validateVerificationNotes(sections, issues);

  if (format === "plan") {
    validatePlanOrdering(body, sections, issues);
  }

  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    format,
    warning: STRUCTURE_WARNING,
    issues,
  };
}

function stripFrontmatter(markdown) {
  const normalized = markdown.replace(/\r\n?/g, "\n");

  if (!normalized.startsWith("---\n")) {
    return normalized;
  }

  const end = normalized.indexOf("\n---", 4);
  if (end === -1) {
    return normalized;
  }

  const after = normalized.slice(end + 4);
  return after.startsWith("\n") ? after.slice(1) : after;
}

function parseHeadings(markdown) {
  const headings = [];
  const pattern = /^(#{1,6})\s+(.+?)\s*#*\s*$/gm;
  let match;

  while ((match = pattern.exec(markdown)) !== null) {
    headings.push({
      level: match[1].length,
      title: match[2].trim(),
      normalized: normalizeHeading(match[2]),
      index: match.index,
      contentStart: pattern.lastIndex,
    });
  }

  for (let index = 0; index < headings.length; index += 1) {
    const heading = headings[index];
    const next = headings
      .slice(index + 1)
      .find((candidate) => candidate.level <= heading.level);
    heading.end = next ? next.index : markdown.length;
    heading.content = markdown.slice(heading.contentStart, heading.end).trim();
  }

  return headings;
}

function normalizeHeading(title) {
  return title
    .toLowerCase()
    .replace(/[`*_~:[\]().,!?]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function findSections(markdown, headings) {
  const sections = new Map();

  for (const heading of headings) {
    const canonical = SECTION_ALIASES.get(heading.normalized);
    if (!canonical || sections.has(canonical)) {
      continue;
    }

    sections.set(canonical, {
      ...heading,
      canonical,
      content: markdown.slice(heading.contentStart, heading.end).trim(),
    });
  }

  return sections;
}

function resolveFormat(markdown, requestedFormat) {
  if (requestedFormat !== "auto") {
    return requestedFormat;
  }

  const planSignals = [
    /\bimplementation checklist\b/i,
    /\bimplementation plan\b/i,
    /\btodos?\b/i,
    /^\s*[-*+]\s+\[[ xX]\]/m,
  ];

  return planSignals.some((signal) => signal.test(markdown)) ? "plan" : "audit";
}

function validateRequiredSections(sections, issues) {
  for (const section of REQUIRED_SECTIONS) {
    if (!sections.has(section)) {
      addIssue(issues, {
        code: "MISSING_SECTION",
        severity: "error",
        message: `Missing required section: ${section}.`,
        fix: `Add a "${section}" heading with the required audit information.`,
        section,
      });
    }
  }
}

function validateFindings(sections, issues) {
  const findings = sections.get("Findings");
  if (!findings) {
    return;
  }

  const severitySections = parseChildSections(findings);
  const hasFindings = hasMeaningfulFindingContent(findings.content);

  if (hasFindings) {
    for (const severity of SEVERITIES) {
      if (!severitySections.has(severity)) {
        addIssue(issues, {
          code: "MISSING_SEVERITY_GROUP",
          severity: "error",
          message: `Findings section is missing the ${severity} severity group.`,
          fix: `Add a "${severity}" subsection under Findings. Empty groups may say "None found."`,
          section: "Findings",
        });
      }
    }
  }

  for (const severity of SEVERITIES) {
    const section = severitySections.get(severity);
    if (!section) {
      continue;
    }

    extractFindingBlocks(section).forEach((block, index) => {
      validateFindingBlock(block, severity, index + 1, issues);
    });
  }
}

function parseChildSections(parent) {
  const pattern = /^(#{1,6})\s+(.+?)\s*#*\s*$/gm;
  const children = [];
  let match;

  while ((match = pattern.exec(parent.content)) !== null) {
    if (match[1].length <= parent.level) {
      continue;
    }

    const title = match[2].trim();
    const canonicalSeverity = SEVERITIES.find(
      (severity) => normalizeHeading(severity) === normalizeHeading(title)
    );

    if (!canonicalSeverity) {
      continue;
    }

    children.push({
      severity: canonicalSeverity,
      level: match[1].length,
      title,
      index: match.index,
      contentStart: pattern.lastIndex,
    });
  }

  const sections = new Map();
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index];
    const next = children
      .slice(index + 1)
      .find((candidate) => candidate.level <= child.level);
    child.end = next ? next.index : parent.content.length;
    child.content = parent.content.slice(child.contentStart, child.end).trim();
    sections.set(child.severity, child);
  }

  return sections;
}

function hasMeaningfulFindingContent(content) {
  return content
    .split("\n")
    .filter((line) => !/^#{1,6}\s+/.test(line.trim()))
    .some((line) => {
      const trimmed = line.trim();
      return (
        trimmed &&
        !/^[-*+]?\s*(none|none found|no findings|n\/a)\.?$/i.test(trimmed)
      );
    });
}

function extractFindingBlocks(section) {
  const lines = section.content.split("\n");
  const blocks = [];
  let current = null;

  const flush = () => {
    if (current && isFindingBlock(current.lines.join("\n"))) {
      blocks.push(current.lines.join("\n").trim());
    }
    current = null;
  };

  for (const line of lines) {
    if (isTopLevelFindingStart(line) || isHeadingFindingStart(line, section.level)) {
      flush();
      current = { lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }

  flush();
  return blocks;
}

function isTopLevelFindingStart(line) {
  const match = /^[-*+]\s+(.+)$/.exec(line);
  return Boolean(match && !isFieldLine(match[1]));
}

function isHeadingFindingStart(line, severityLevel) {
  const match = /^(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
  return Boolean(
    match &&
      match[1].length > severityLevel &&
      !FIELD_NAMES.includes(normalizeHeading(match[2]))
  );
}

function isFieldLine(text) {
  return FIELD_NAMES.includes(normalizeHeading(text.split(":")[0] || ""));
}

function isFindingBlock(block) {
  const trimmed = block.trim();
  return Boolean(
    trimmed && !/^[-*+]?\s*(none|none found|no findings|n\/a)\.?$/i.test(trimmed)
  );
}

function validateFindingBlock(block, severity, findingNumber, issues) {
  const section = `Findings > ${severity}`;
  const title = firstLineTitle(block) || `${severity} finding ${findingNumber}`;

  for (const field of FINDING_FIELDS) {
    if (!hasField(block, field)) {
      addIssue(issues, {
        code: "MISSING_FINDING_FIELD",
        severity: "error",
        message: `${title} is missing ${field}.`,
        fix: `Add a ${field}: entry to the finding.`,
        section,
      });
    }
  }

  const label = extractVerificationLabel(block);
  if (label && !VERIFICATION_LABELS.includes(label)) {
    addIssue(issues, {
      code: "INVALID_VERIFICATION_LABEL",
      severity: "error",
      message: `${title} uses unsupported verification label "${label}".`,
      fix: `Use one of: ${VERIFICATION_LABELS.join(", ")}.`,
      section,
    });
  }

  const confidence = extractConfidenceLabel(block);
  if (confidence && !CONFIDENCE_LABELS.includes(confidence)) {
    addIssue(issues, {
      code: "INVALID_CONFIDENCE_LABEL",
      severity: "error",
      message: `${title} uses unsupported confidence label "${confidence}".`,
      fix: "Use Confidence: High, Confidence: Medium, or Confidence: Low.",
      section,
    });
  }
}

function firstLineTitle(block) {
  return block
    .split("\n")
    .map((line) => line.replace(/^[-*+]\s+/, "").replace(/^#{1,6}\s+/, "").trim())
    .find(Boolean);
}

function hasField(block, field) {
  return fieldRegex(field).test(block);
}

function fieldRegex(field) {
  return new RegExp(
    String.raw`(?:^|\n)\s*(?:[-*+]\s*)?(?:\*\*)?${escapeRegExp(
      field
    )}(?:\*\*)?\s*:`,
    "i"
  );
}

function extractVerificationLabel(block) {
  const line = extractFieldLabel(block, "Verification");
  if (!line) {
    return line;
  }

  for (const label of VERIFICATION_LABELS) {
    if (line === label || line.startsWith(`${label} `) || line.startsWith(`${label}.`)) {
      return label;
    }
  }

  return line;
}

function extractFieldLabel(block, field) {
  const fieldMatch = fieldRegex(field).exec(block);
  if (!fieldMatch) {
    return null;
  }

  const line = block
    .slice(fieldMatch.index + fieldMatch[0].length)
    .split("\n")[0]
    .trim()
    .toLowerCase()
    .replace(/^["'`]+|["'`.]+$/g, "")
    .replace(/\s*[-:;].*$/, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!line) {
    return "";
  }

  return line;
}

function extractConfidenceLabel(block) {
  const line = extractFieldLabel(block, "Confidence");
  if (!line) {
    return line;
  }

  for (const label of CONFIDENCE_LABELS) {
    if (line === label || line.startsWith(`${label} `) || line.startsWith(`${label}.`)) {
      return label;
    }
  }

  return line.split(/\s+/)[0];
}

function validateCoverageMap(sections, issues) {
  const coverage = sections.get("Coverage Map");
  if (!coverage) {
    return;
  }

  if (!hasMarkdownTable(coverage.content) && !hasListLikeCoverage(coverage.content)) {
    addIssue(issues, {
      code: "COVERAGE_MAP_EMPTY",
      severity: "error",
      message: "Coverage Map does not contain a table or list of covered areas.",
      fix: "Add coverage rows for docs, code evidence, public surfaces, and status.",
      section: "Coverage Map",
    });
    return;
  }

  const scopeText = [
    sections.get("Executive Summary")?.content,
    coverage.content,
    sections.get("Verification Notes")?.content,
  ]
    .filter(Boolean)
    .join("\n");
  const sampled = /\bsampled\b|\bsample\b|\bspot[- ]check/i.test(scopeText);
  const suggestsPartial =
    /\bpartial (audit|coverage|review|inventory|pass)\b|\bsubset\b|\brepresentative\b|\bspot[- ]check/i.test(
      scopeText
    );

  if (suggestsPartial && !sampled) {
    addIssue(issues, {
      code: "SAMPLED_SCOPE_UNDISCLOSED",
      severity: "error",
      message: "Audit appears partial but does not explicitly say it was sampled.",
      fix: "State that the audit was sampled in Executive Summary, Coverage Map, or Verification Notes.",
      section: "Coverage Map",
    });
  }

  if (!sampled) {
    validateWholeRepoCoverage(coverage.content, issues);
  }
}

function hasMarkdownTable(content) {
  return /\|[^|\n]+\|/.test(content) && /\|?\s*:?-{3,}:?\s*\|/.test(content);
}

function hasListLikeCoverage(content) {
  return /^[-*+]\s+\S+/m.test(content) || /^\d+\.\s+\S+/m.test(content);
}

function validateWholeRepoCoverage(content, issues) {
  const docTypePattern =
    /\b(readme|setup|install|api|architecture|runbook|troubleshooting|security|contributing|changelog|reference|guide)\b/i;
  const publicSurfacePattern =
    /\b(cli|command|api|route|endpoint|sdk|config|env|service|package|module|public surface|workflow|schema)\b/i;

  if (!docTypePattern.test(content)) {
    addIssue(issues, {
      code: "COVERAGE_MAP_MISSING_DOC_TYPES",
      severity: "error",
      message: "Whole-repo audit coverage map does not cover documentation types.",
      fix: "Add rows for relevant doc types such as README, setup, API, architecture, runbooks, troubleshooting, or security docs.",
      section: "Coverage Map",
    });
  }

  if (!publicSurfacePattern.test(content)) {
    addIssue(issues, {
      code: "COVERAGE_MAP_MISSING_PUBLIC_SURFACES",
      severity: "error",
      message: "Whole-repo audit coverage map does not cover public product surfaces.",
      fix: "Add rows for public surfaces such as CLIs, APIs, routes, config, schemas, services, packages, or workflows.",
      section: "Coverage Map",
    });
  }
}

function validateVerificationNotes(sections, issues) {
  const verification = sections.get("Verification Notes");
  if (!verification) {
    return;
  }

  const content = verification.content;
  const disclosesOrbitState =
    /\borbit\b.*\b(used|unavailable|not available|intentionally not checked|not checked)\b/i.test(
      content
    ) ||
    /\b(used|unavailable|not available|intentionally not checked|not checked)\b.*\borbit\b/i.test(
      content
    );

  if (!/\borbit\b/i.test(content) || !disclosesOrbitState) {
    addIssue(issues, {
      code: "ORBIT_DISCLOSURE_MISSING",
      severity: "error",
      message:
        "Verification Notes do not disclose whether Orbit was used, unavailable, or intentionally not checked.",
      fix: 'Add an Orbit note such as "Orbit unavailable; local evidence used instead."',
      section: "Verification Notes",
    });
  }
}

function validatePlanOrdering(markdown, sections, issues) {
  const missingSections = REQUIRED_SECTIONS.filter((section) => !sections.has(section));
  if (missingSections.length > 0) {
    return;
  }

  const lastRequiredStart = Math.max(
    ...REQUIRED_SECTIONS.map((section) => sections.get(section).index)
  );
  const firstChecklist = findFirstImplementationChecklist(markdown);

  if (firstChecklist !== -1 && firstChecklist < lastRequiredStart) {
    addIssue(issues, {
      code: "PLAN_CHECKLIST_BEFORE_AUDIT",
      severity: "error",
      message:
        "Plan checklist or todo content appears before Philip audit sections are complete.",
      fix:
        "Move implementation checklists and todos after Executive Summary, Findings, Coverage Map, Recommended Plan, Unknowns, and Verification Notes.",
      section: "Recommended Plan",
    });
  }
}

function findFirstImplementationChecklist(markdown) {
  const patterns = [
    /^#{1,6}\s+.*\b(implementation checklist|implementation tasks|todo|todos|checklist)\b.*$/gim,
    /^\s*[-*+]\s+\[[ xX]\]/gm,
  ];
  const indexes = patterns
    .map((pattern) => {
      const match = pattern.exec(markdown);
      return match ? match.index : -1;
    })
    .filter((index) => index !== -1);

  return indexes.length > 0 ? Math.min(...indexes) : -1;
}

function addIssue(issues, issue) {
  issues.push({
    code: issue.code,
    severity: issue.severity,
    message: issue.message,
    fix: issue.fix,
    section: issue.section,
  });
}

function printPlain(result, file) {
  const label = file === "-" ? "stdin" : file;
  process.stdout.write(`${STRUCTURE_WARNING}\n\n`);

  if (result.issues.length === 0) {
    process.stdout.write(`PASS ${label} (${result.format})\n`);
    return;
  }

  const errorCount = result.issues.filter((issue) => issue.severity === "error")
    .length;
  const warningCount = result.issues.length - errorCount;
  const status = errorCount > 0 ? "FAIL" : "PASS";

  process.stdout.write(
    `${status} ${label} (${result.format}): ${errorCount} error(s), ${warningCount} warning(s)\n`
  );

  for (const issue of result.issues) {
    process.stdout.write(
      `- [${issue.severity}] ${issue.code} (${issue.section}): ${issue.message}\n  Fix: ${issue.fix}\n`
    );
  }
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

main();
