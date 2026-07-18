# Hindsight Ops — REST API recipes (podman, this machine)

All calls hit the nginx front (`http://localhost:8080`). From inside a container
the host is `host.containers.internal`, NOT `localhost`.

## Banks
```
GET    /v1/default/banks                                  # list all banks + fact_count
PUT    /v1/default/banks/<bank_id>   body:{"mission":"..."} # create/replace bank
DELETE /v1/default/banks/<bank_id>                     # wipe bank + ALL memories
```
Example:
```bash
curl -s -X PUT http://localhost:8080/v1/default/banks/chronos-ecosystem \
  -H 'Content-Type: application/json' \
  -d '{"mission":"Shared long-term memory for the Chronos desktop-shell ecosystem ..."}'
curl -s -X DELETE http://localhost:8080/v1/default/banks/zed
```

## Mental models (bank-scoped — use THIS, not the MCP tool)
```
GET  /v1/default/banks/<bank_id>/mental-models
POST /v1/default/banks/<bank_id>/mental-models   body:{
   "name":"<name>",
   "source_query":"<question the model answers>",
   "max_tokens":2048,
   "tags":["project:chronos"],
   "trigger_refresh_after_consolidation":true
}
```
Content is generated asynchronously; poll `GET` until `content` != "Generating content...".

## MCP endpoints (per bank)
```
POST /mcp/<bank_id>/     # Zed / Hermes connect here (initialize handshake)
```
Hitting `/mcp/zed/` auto-creates the `zed` bank if absent — harmless if clients
are pinned to `/mcp/chronos-ecosystem/`.

## LLM backend (env in `hindsight-api` container)
| Var | Default | Notes |
|---|---|---|
| `HINDSIGHT_API_LLM_BASE_URL` | `http://host.containers.internal:8085/v1` | beellama llama-server |
| `HINDSIGHT_API_LLM_MODEL` | `Agents-A1-Q4_K_M.gguf` | |
| `HINDSIGHT_API_LLM_PROVIDER` | `openai` | |
| `HINDSIGHT_API_LLM_API_KEY` | `not-needed` | auth off on dataplane |

User's gateway: `BASE_URL=http://host.containers.internal:20128/v1`, `MODEL=hindsight`
(routes to openrouter/tencent/hy3:free etc). Editing live container env does NOT
survive restart unless the deployment source (quadlet/compose/start-all.sh) is
patched — find it first (this session: podman CreateCommand carried the env
inline; no quadlet found in /etc/containers or ~/.config/containers).
