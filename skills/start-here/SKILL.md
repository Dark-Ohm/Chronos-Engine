---
name: start-here
description: Use when starting any work in the Chronos-Engine repo - gives repo orientation, which docs to read first, and which skill to invoke for the task at hand
---

# Chronos-Engine — Start Here

This repo is **Chronos-Engine**: a C/C++ private fork of **llama.cpp**,
extended with custom KV-cache compression (KVarN pseudo-types + TurboQuant
real types), MoE expert prefetch/host-pin (codacus), and a tiered hot/cold
KV-offload track targeting 262K context on 8GB VRAM. It is **NOT** the
ChronOS Rust/GPUI desktop shell — different repo, different language.
Speculative decoding is upstream-native only (donor DFlash was rejected, D-001).

## Read first (in order)
1. `AGENTS.md` — Chronos header: which upstream rules apply here (style only)
   and which do not. AI trailers are FORBIDDEN in commits, always.
2. `ARCHITECTURE.md` — canon; section «Принятые решения раунда 4» is current.
3. `HANDOFF.md` — live session context: engine state, next steps, minion roster.
4. `DECISIONS.log` — rejected alternatives and why (D-001 … D-014).

## Orchestration model
Lead Architect (Claude) assigns tasks via minion files: `GROK.md`, `ZED.md`,
`OPENCODE.md`, `CLINE.md`, `HERMES.md` (`OMP.md` closed — executor fired).
Convention: each file holds ONLY the current task (full rewrite per task,
history in `git log -- <FILE>.md`). Reports go to `<name>-report.md` in repo
root; accepted reports are moved to `dump/`. Architect verifies every report
claim against the tree, then commits (minions never commit; commit style
`область : что сделано`, no AI trailers ever).

## Build / test surface
Minions must NOT build or test unless their task file explicitly allows it
(currently only Grok may rebuild the release `build/`). Debug builds go to
`build-debug/`, never into `build/`. Live smokes: see HANDOFF.md «Смоки»
(port 8099 for Zed editor, `-fit off` for kvarn runs, watch VRAM background).

## Which skill for the task
- Any bug/failure investigation → `systematic-debugging`
- C/C++ change → `test-driven-development`; before claiming done →
  `verification-before-completion`
- Writing or auditing docs → `philip-main`
- Porting from donors (`donors/thetom-turboquant` is the turbo etalon,
  beellama its derivative, codacus for MoE) → read `DECISIONS.log` first,
  then `writing-plans`
- Finishing a branch → `finishing-a-development-branch`
