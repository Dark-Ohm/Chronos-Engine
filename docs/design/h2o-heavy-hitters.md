# H2O Heavy-Hitters Design for Tiered KV Offload (Phase 2) — DEPRECATED

> **⚠️ This file is deprecated and its body has been removed.**
> **Current specification:** [`h2o-heavy-hitters-PHASE2-SPEC.md`](h2o-heavy-hitters-PHASE2-SPEC.md)
> **Architecture index:** [`../../.chronos-ops/checkpoint/ARCHITECTURE.md`](../../.chronos-ops/checkpoint/ARCHITECTURE.md)
>
> This file previously duplicated the full spec body below the notice
> above — that duplicate carried a stale scoring formula
> (`rowsum(softmax(QK^T))`, mathematically meaningless as an importance
> score, see canonical spec §1.3 for the fix and why) that survived here
> even after the canonical file was corrected (2026-08-15, T000). Kept as
> a redirect stub only, so nobody copies from a duplicate that can drift
> from the canon again.
