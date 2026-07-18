# Auditing AI-Generated Docs — Verification Recipe & Hallucination Patterns

When Philip is asked to audit docs that an LLM drafted (or that were bulk-written
and never re-checked against source), the citations are **not** trustworthy by
default. Specific-looking citations are the most dangerous: they *feel* verified.
They are claims. This file is the recipe and a worked example.

## Known hallucination patterns (in order of how often they appear)

1. **Phantom helper functions** — a doc shows `def _is_mcp_toolset_name(...)` or
   `_wrap_handler(...)` that does not exist. The real code inlines the logic or
   does it elsewhere. Fix: grep for the name; if it has no `def`/`class`, it's fake.
2. **Method/class name off by a word** — `HindsightProvider` vs real
   `HindsightMemoryProvider`; `reflect()`/`query()` where the real surface is
   `hindsight_recall`/`hindsight_retain` tool handlers. Fix: grep the doc's
   symbol names; confirm each resolves to a definition.
3. **Drifted `file:LINE` ranges** — `trajectory_compressor.py:531-570` may point
   at nothing like the doc describes; the real function is at `477-513`. Line
   numbers move; verify by reading the cited range and checking the described
   code is actually there. Trust the symbol + surrounding code, not the number.
4. **Invented env vars** — `requires_env=["PLAYWRIGHT_DRIVER"]` with no such var
   defined anywhere. Real gating uses a `check_fn`. Fix: `grep -rn "PLAYWRIGHT_DRIVER"`
   across the repo; zero hits + no config wiring = fabricated.
5. **Nonexistent example files** — `tools/browser_navigate.py` when the real
   tools are `browser_tool.py`, `browser_cdp_tool.py`, `browser_camofox.py`, etc.
   Fix: list the actual files before quoting one.
6. **Wrong error schema** — doc claims `{"error": ..., "status": "error"}` but the
   real handler returns `{"error": "<TypeName>: <msg>"}` (no `status` key).
   Fix: read the real dispatch/error path.
7. **Fabricated event-loop / architecture claims** — "dedicated event loop" where
   the code uses a shared module-level loop; "reflect (memory synthesis)" where no
   such method exists. Fix: grep the claimed symbol; read the architecture block's
   every named component against source.

## Verification recipe (run per cited symbol / range)

```bash
# 1. Does a named function/class/method actually exist?
grep -rn "def <name>\|class <name>\|<name> =" <file>

# 2. Does a cited env var exist anywhere (and is it wired)?
grep -rn "<VARNAME>" <repo>

# 3. Does the cited file exist at all?
ls <repo>/<path>/<file>.py

# 4. Does the cited line range contain what the doc claims?
#    read_file the range; confirm symbol + surrounding code match.
```

If a symbol fails any check, it is fabricated. **Replace it with the real
equivalent** (verify the real one exists) rather than just deleting — the doc
should still teach correctly. If no real equivalent exists, state that
explicitly (e.g. "`_maybe_compress_context` is fabricated; live compression
lives in `agent/context_compressor.py:662`").

## Worked example (Hermes research docs audit, 2026-07-07)

Seven AI-drafted research docs (`research/*.md`) claimed code evidence. Spot
checks found:

- `03-HINDSIGHT`: invented `reflect()`/`query()`/`_submit_op`/`_retain_one`/
  `HindsightProvider`/`_translate_filter`. Real: `HindsightMemoryProvider`
  (`:621`), `sync_turn` (`:1603`), `handle_tool_call` recall/retain/reflect
  (`:1703+`), `shutdown` (`:1905`). Also `_get_loop()` is a shared module-level
  loop, not "dedicated".
- `04-COMPRESSION`: invented `_find_compression_boundary`,
  `_find_clean_turn_boundaries`, `_summarize_via_api`, `_maybe_compress_context`,
  and `protect_last_n_turns=20` as the trajectory default (real default is `4`;
  `20` is the live-chat `config.yaml` value). Real: `TrajectoryCompressor.
  _find_protected_indices` (`:477`), `_is_boundary_clean`/`_snap_boundary`
  (`:526-562`), `compress_trajectory` (`:743`).
- `05-TOOL-REGISTRY`: invented `browser_navigate.py` + `requires_env=
  ["PLAYWRIGHT_DRIVER"]`; invented `_is_mcp_toolset_name` (real: inline
  `startswith("mcp-")` at `:385`/`:470`); invented `_wrap_handler` + `{"status":
  "error"}` (real: `dispatch()` returns `{"error": "..."}` at `:574-600`).
- `README` diagram: "dedicated event loop" + `reflect` (memory synthesis) — both
  wrong; corrected to shared loop + real tool handlers.

All fixed by replacing fabricated blocks with real, verified code blocks and
explicit "this was fabricated" notes. Severity: Critical for fabricated code
blocks, High for fabricated prose symbols.

## Severity guide for fabricated citations

- **Critical** — fabricated symbol inside a fenced code block presented as evidence.
- **High** — fabricated symbol in prose ("`reflect()` synthesizes memories").
- **Medium** — correct symbol but wrong `file:LINE` range (misleads navigation).
- **Low** — cosmetic (example var name, illustrative-only schema).

When the first spot-check in a doc fails, treat *every* remaining citation in
that doc as suspect until verified.
