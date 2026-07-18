#!/usr/bin/env sh
set -eu

repo="$(mktemp -d)"
trap 'rm -rf "$repo"' EXIT
git -C "$repo" init -b main >/dev/null 2>&1 || { git -C "$repo" init >/dev/null; git -C "$repo" checkout -B main >/dev/null; }
git -C "$repo" config user.name "Philip Test"
git -C "$repo" config user.email "philip@example.invalid"
printf '# Example\n' > "$repo/README.md"
git -C "$repo" add README.md
git -C "$repo" commit -m "Initial commit" >/dev/null
printf '# Example\n\nChanged.\n' > "$repo/README.md"

node "$PWD/bin/philip.js" diff --json > "$repo/stdout" 2> "$repo/stderr"
test ! -s "$repo/stderr"
jq -e '.ok == true and .artifact.kind == "actionable_diff" and .artifact.schemaVersion == 1' "$repo/stdout" >/dev/null
