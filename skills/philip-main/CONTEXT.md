# Philip

Philip is an evidence-backed documentation and review skill for software projects. It turns codebase changes into canonical Markdown docs, review context, and actionable follow-up work for humans and agents without becoming a general app builder.

## Language

**Canonical documentation**:
Long-lived project documentation that users are expected to read, edit, review in diffs, and keep under version control.
_Avoid_: Artifact, report, output

**HTML artifact**:
A self-contained HTML document generated to make dense documentation and review work easier to understand, explore, compare, present, or interact with.
_Avoid_: HTML doc, web page, `/html` mode

**Review artifact**:
A temporary or companion artifact whose job is to help humans or agents evaluate, understand, or act on codebase change before or alongside canonical documentation.
_Avoid_: Canonical doc, source of truth

**Actionable diff**:
A structured interpretation of Git changes that connects changed files, identifiers, docs, plans, investigations, and tests to concrete review or follow-up actions.
_Avoid_: Changelog, audit report, diff summary

**Branch state artifact**:
An **HTML artifact** generated from an **Actionable diff** to help humans review the current state of a branch or workstream.
_Avoid_: HTML skill output, changelog, release notes

**Artifact store**:
The project-local `.philip/artifacts/` directory where Philip writes generated review artifacts by default, grouped by human-recognizable workstream names such as sanitized branch names.
_Avoid_: Skill package folder, docs folder by default, build dist, silent `.gitignore` edits, generic artifact-type-only folders

**Artifact generation prompt**:
A minimal prompt that explains the available **Actionable diff** data model to a rendering agent without prescribing layout, styling, priority judgments, or interpretation policy.
_Avoid_: Template, design system, renderer spec, style prompt, HTML skill, app builder

**HTML audit review artifact**:
An **HTML artifact** that presents a Philip documentation audit with richer navigation, filtering, evidence expansion, and coverage visualization.
_Avoid_: Audit doc, canonical audit

**Diff impact metrics**:
Quantified facts from Git changes, such as changed files, changed lines, touched documentation files, touched change surfaces, and changed identifiers.
_Avoid_: Severity, confidence, importance

**Repo inventory**:
A factual inventory of repository files and simple counts, such as top-level entries, file counts by extension, known manifests, workflow files, and changed-file counts by directory.
_Avoid_: Codebase shape, architecture map, important modules

**Git activity**:
A future extension containing simple Git-history aggregations, such as commit counts by file or directory and recent changes over a time window.
_Avoid_: Hot paths, critical files, risk scoring

**Diff collector script**:
A deterministic script that gathers Git and filesystem facts for `philip-diff.json` so agents do not have to reconstruct the data collection flow manually.
_Avoid_: Agent-only Git spelunking, ad hoc shell transcript

**Change surface**:
A part of the codebase, documentation set, or project thinking touched by a diff that may be relevant to review, documentation, handoff, or follow-up work.
_Avoid_: Public surface, public service

**Impact heuristic**:
A documented rule that derives review priority from **Diff impact metrics** and evidence categories rather than unsupported agent judgment.
_Avoid_: Vibes, agent confidence, subjective severity

## Relationships

- **Canonical documentation** is the source of truth for durable project knowledge.
- An **HTML artifact** can accompany **canonical documentation**, but does not replace it by default.
- A **Review artifact** can be deleted or regenerated without losing durable project knowledge.
- An **HTML audit review artifact** accompanies a documentation audit; it is not the sole audit source of truth by default.
- An **Actionable diff** is the structured source for review-oriented Markdown docs, HTML artifacts, and agent follow-up prompts.
- A **Branch state artifact** renders an **Actionable diff** for human review.
- An **Artifact generation prompt** should describe collected data and constraints, not decide what the artifact must emphasize or how it should argue its case.
- Philip owns canonical Markdown writing and evidence-backed review context; it should not become a general HTML app builder.
- The **Artifact store** is local generated output and should be gitignored by project policy, but Philip should not silently edit `.gitignore`.
- **Branch state artifacts** should be stored under a human-recognizable workstream folder, usually the sanitized branch name, with `index.html` as the primary entry point and `philip-diff.json` as the latest structured data.
- The **Artifact store** should maintain a top-level `index.html` that links to workstream artifact folders.
- **Diff impact metrics** measure changed **Change surfaces**.
- **Diff impact metrics** can become inputs to a future **Impact heuristic**.
- A **Diff collector script** should gather the repeatable Git and filesystem facts for an **Actionable diff**.
- **Git activity** can extend an **Actionable diff** later with raw history aggregations, without claiming importance or risk.
- An **Impact heuristic** can rank review attention, but should expose the underlying **Diff impact metrics** that produced the ranking.

## Example dialogue

> **Dev:** "Should Philip write the setup guide as HTML?"
> **Domain expert:** "No. The setup guide is **Canonical documentation**. If the setup review is dense, Philip can create an **HTML artifact** beside it."

## Flagged ambiguities

- "HTML doc" was ambiguous between long-lived documentation and a generated review surface. Resolved: use **HTML artifact** for generated review/exploration/presentation surfaces, and **Canonical documentation** for durable docs.
- "Impact" was ambiguous between subjective agent judgment and quantified change evidence. Resolved: use **Diff impact metrics** for measured facts and **Impact heuristic** for any derived ranking.
- "Public surface" was too narrow and implied only user-facing APIs or released interfaces. Resolved: use **Change surface** for any diff-touched area that may matter to team review, documentation, or handoff.
- "Documenting what happened" was too passive for Philip's emerging direction. Resolved: Philip should produce **Actionable diffs** that make changes reviewable and turn them into next actions for humans and agents.
