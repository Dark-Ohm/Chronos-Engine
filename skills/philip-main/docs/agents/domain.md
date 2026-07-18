# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout

Philip is a single-context repo.

Read:

- `CONTEXT.md` at the repo root before architecture, diagnosis, TDD, or planning work.
- `docs/adr/` if it exists and contains decisions relevant to the current work.

If `docs/adr/` does not exist, proceed silently. Do not create ADRs unless the user asks or a decision needs to be recorded.

## Use the glossary's vocabulary

When output names a domain concept in a bead title, refactor proposal, hypothesis, test name, or implementation plan, use the term as defined in `CONTEXT.md`.

Do not drift to synonyms the glossary explicitly avoids.

## Flag ADR conflicts

If output contradicts an existing ADR, surface it explicitly rather than silently overriding it:

> _Contradicts ADR-0007 — but worth reopening because..._

## Updating domain docs

Only update `CONTEXT.md` or create ADRs when terminology or decisions actually crystallize. Do not create domain docs merely because they are absent.
