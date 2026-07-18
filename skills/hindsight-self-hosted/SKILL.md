---
name: hindsight-self-hosted
description: ACTUAL Hindsight deployment for Chronos — podman stack, bank chronos-ecosystem shared by Hermes + Zed, beellama/:20128 LLM. Use for any Hindsight memory op. (project)
---

# Hindsight Memory — Self-Hosted (THIS project)

This is the memory layer actually deployed for Chronos. The sibling skills
`hindsight-local` and `hindsight-cloud` describe managed/embed CLI flows
(`uvx hindsight-embed`, `hindsight memory retain`) that are **NOT** deployed
here — ignore them. This skill is the real one.

## Reality

- **Stack** (`hindsight-*` podman containers in pod `pod_hindsight`): `hindsight-nginx` (`:8080` api / `:8081` dashboard) → `hindsight-api` (`:8888`) → `hindsight-db` (pgvector pg18) + `hindsight-embeddings` + `hindsight-reranker` (TEI). From host only `:8080`/`:8081` are reachable; internals resolve only inside the podman net.
- **Bank**: `chronos-ecosystem` (single shared bank — Hindsight banks do NOT share data, so one bank, not per-client).
- **LLM**: extraction/synthesis backend. **Current (2026-07-11):** user's local proxy gateway at `http://host.containers.internal:20128/v1`, combo model name `hindsight` (routes to openrouter models: tencent/Hy3, nvidia/nemotron-3-ultra-550b, etc.). The earlier `beellama` llama-server on `:8085` (`Agents-A1-Q4_K_M.gguf`) is **no longer used**. The deployment source (`docker/podman/.env` + `podman-compose.yaml`) carries the `:20128`/`hindsight` values; `podman-compose.yaml` defaults `LLM_BASE_URL`/`LLM_MODEL` to `:20128`/`hindsight` via `${VAR:-default}`. See `references/hindsight-ops.md` for switching.
- **Clients**:
  - **Hermes** (this assistant): memory-*provider* `hindsight`, `~/.hermes/profiles/chronos/hindsight/config.json` (`api_url=http://localhost:8080`, `bank_id=chronos-ecosystem`, `mode=local_external`). It is NOT an MCP server — `hermes config set memory.provider hindsight`.
  - **Zed**: MCP server URL `http://localhost:8080/mcp/chronos-ecosystem/` (in `~/.config/zed/settings.json`).
- **Auth**: disabled on the dataplane (listens `0.0.0.0`). Do not expose `:8080`/`:8081` to LAN without a tenant API key.
- **Dashboard**: `http://localhost:8081` (Memories / Observations / Mental Models / Recall Analyzer).

## CRITICAL — MCP tools ignore `bank_id`

`mcp__hindsight_zed__*` tools (retain / recall / get_bank / list_documents /
create_mental_model / delete_bank) operate on the **MCP session's default bank**,
NOT the `bank_id` you pass. The parameter is silently ignored.

This burned us: `create_mental_model` wrote into `zed` (the default) instead of
`chronos-ecosystem`; when `zed` was later deleted to reset the system, those
mental models were lost. `get_bank` / `list_documents` also returned `zed`
regardless of intent.

**Rule:** for any bank-scoped operation, use the **REST API** with explicit bank
paths (see `references/hindsight-ops.md`), not the MCP tools. The MCP tools are
fine only for operations that don't care which bank (e.g. a `recall` against the
bank the client is already pinned to).

## Reset a bank to zero (procedure that worked)

1. `DELETE /v1/default/banks/zed`, `DELETE /v1/default/banks/hermes`,
   `DELETE /v1/default/banks/chronos-ecosystem` (via API — the MCP `delete_bank`
   tool may apply to the wrong/default bank).
2. `PUT /v1/default/banks/chronos-ecosystem` with the mission string.
3. Recreate the 3 mental models via `POST /v1/default/banks/chronos-ecosystem/mental-models`
   (NOT via `create_mental_model` MCP tool). Canonical set:
   - `chronos-project-state` — "What is the current architecture, key decisions, and status of the Chronos desktop shell project (Rust + Kael 0.3 + sandboxed mlua/LuauJIT on Hyprland/Niri)? Summarize the consolidated state."
   - `user-preferences` — "What is the user's communication style, ML/systems expertise level, and engineering conventions? Summarize how to interact with them effectively."
   - `chronos-build-issues` — "What recurring build/runtime issues exist in the Chronos project (cargo, GPUI, LuaU bindings, Hyprland integration)? Identify unresolved patterns."
4. Note: `zed` auto-resurrects if any client hits `/mcp/zed/`. Harmless while Zed
   and Hermes are pinned to `/mcp/chronos-ecosystem/`.

## Switching the LLM backend

Edit env in `hindsight-api`: `HINDSIGHT_API_LLM_BASE_URL` + `HINDSIGHT_API_LLM_MODEL`
(`HINDSIGHT_API_LLM_PROVIDER=openai`). From the container, host is
`host.containers.internal`. User's gateway: `BASE_URL=http://host.containers.internal:20128/v1`,
`MODEL=hindsight`. **Editing a live container does NOT survive restart** unless the
deployment source (quadlet/compose/start-all.sh) is patched — find it first.

## Pitfalls

- **Compose `.env` overrides `${VAR:-default}` — and restart ≠ recreate for env changes.** `podman-compose.yaml` sets `HINDSIGHT_API_LLM_BASE_URL: ${HINDSIGHT_API_LLM_MODEL:-...20128...}` etc. The `:-default` ONLY applies when the var is **empty/absent** in `.env`. If `.env` still contains a literal `HINDSIGHT_API_LLM_BASE_URL=http://host.containers.internal:8085/v1` (or `Agents-A1-Q4_K_M.gguf`), compose substitutes **that literal**, not the `:20128` default — so the switch silently doesn't happen. `podman container inspect` will show the substituted (literal) value in `Config.Env`, which looks like a hardcoded value but is just compose having expanded `${VAR}`. To actually apply a new LLM endpoint: (a) edit `.env` to empty/remove those two lines (so the default fires) OR set them explicitly to `:20128`/`hindsight`; (b) **recreate** the api container — `podman compose up -d --force-recreate api` (a plain `restart` does NOT re-read env). Verify with `podman exec hindsight-api sh -c 'echo $HINDSIGHT_API_LLM_BASE_URL $HINDSIGHT_API_LLM_MODEL'`. Also: inside the container use `host.containers.internal` (host side), NOT `localhost` — container `localhost` is the api itself.
- **Never cite a file/skill path you haven't verified on disk.** This session we
  referenced `chronos-shell/references/hindsight-llama-infra.md` in 4 docs — the
  file never existed. Verify with `ls` / `search_files` before writing a path into
  project docs.
- **`chronos-shell` (ChronOS) is a separate project, not this repo (Chronos-Engine).**
  `/home/neo/Projects/chronos-shell` does NOT exist (renamed to `chronos` / ChronOS).
  Don't treat it as a separate project.
- **Hindsight ≠ project documentation.** It stores extracted facts/observations,
  not architecture. On conflict, repo docs (`ARCHITECTURE.md` / `DECISIONS.log`) win.
- **Memory layers:** repo docs (canonical) / lean-ctx (session) / engram (durable
  facts) / Hindsight (RAG over accumulated context, shared Hermes+Zed) / dialog
  (ephemeral). See `MEMORY.md` "Слои памяти проекта" in the repo.

Full re-runnable command reference (podman stack, llama-server, Hermes wiring,
API recipes): see `references/hindsight-ops.md`.
