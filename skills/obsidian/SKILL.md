---
name: obsidian
description: Read, search, create, and edit skills in the Obsidian vault.
platforms: [linux, macos, windows]
---

# Obsidian Vault

Use this skill for filesystem-first Obsidian vault work: reading skills, listing skills, searching skill files, creating skills, appending content, and adding wikilinks.

ALWAYS use with : 

-/home/neo/.hermes/profiles/chronos/skills/philip-main
-/home/neo/.hermes/profiles/chronos/skills/hermes-agent-skill-authoring
-/home/neo/.hermes/profiles/chronos/skills/start-here
-/home/neo/.hermes/profiles/chronos/skills/writing-skills
-/home/neo/.hermes/profiles/default/skills/verification-before-completion

## Vault path

Use a known or resolved vault path before calling file tools.

The documented vault-path convention is the `OBSIDIAN_VAULT_PATH` environment variable, for example from `${HERMES_HOME:-~/.hermes}/.env`. If it is unset, use `/home/neo/.hermes/profiles/chronos/skills`.

File tools do not expand shell variables. Do not pass paths containing `$OBSIDIAN_VAULT_PATH` to `read_file`, `write_file`, `patch`, or `search_files`; resolve the vault path first and pass a concrete absolute path. Vault paths may contain spaces, which is another reason to prefer file tools over shell commands.

If the vault path is unknown, `terminal` is acceptable for resolving `OBSIDIAN_VAULT_PATH` or checking whether the fallback path exists. Once the path is known, switch back to file tools.

## Read a skill

Use `read_file` with the resolved absolute path to the skill. Prefer this over `cat` because it provides line numbers and pagination.

## List skills

Use `search_files` with `target: "files"` and the resolved vault path. Prefer this over `find` or `ls`.

- To list all markdown skills, use `pattern: "*.md"` under the vault path.
- To list a subfolder, search under that subfolder's absolute path.

## Search

Use `search_files` for both filename and content searches. Prefer this over `grep`, `find`, or `ls`.

- For filenames, use `search_files` with `target: "files"` and a filename `pattern`.
- For skill contents, use `search_files` with `target: "content"`, the content regex as `pattern`, and `file_glob: "*.md"` when you want to restrict matches to markdown skills.

## Create a skill

Use `write_file` with the resolved absolute path and the full markdown content. Prefer this over shell heredocs or `echo` because it avoids shell quoting issues and returns structured results.

## Append to a skill

Prefer a native file-tool workflow when it is not awkward:

- Read the target skill with `read_file`.
- Use `patch` for an anchored append when there is stable context, such as adding a section after an existing heading or appending before a known trailing block.
- Use `write_file` when rewriting the whole skill is clearer than constructing a fragile patch.

For an anchored append with `patch`, replace the anchor with the anchor plus the new content.

For a simple append with no stable context, `terminal` is acceptable if it is the clearest safe option.

## Targeted edits

Use `patch` for focused note changes when the current content gives you stable context. Prefer this over shell text rewriting.

## Wikilinks

Obsidian links skills with `[[Note Name]]` syntax. When creating skills, use these to link related content.
