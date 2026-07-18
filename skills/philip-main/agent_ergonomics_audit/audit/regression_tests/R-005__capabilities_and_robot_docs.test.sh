#!/usr/bin/env sh
set -eu

capabilities="$(mktemp)"
guide="$(mktemp)"
trap 'rm -f "$capabilities" "$guide"' EXIT

node bin/philip.js capabilities --json > "$capabilities"
jq -e '.tool == "philip" and any(.commands[]; .name == "diff") and .exitCodes["2"] == "user-input-error"' "$capabilities" >/dev/null
node bin/philip.js robot-docs guide > "$guide"
grep -q '^# Philip Agent Quick Guide' "$guide"
grep -q 'philip diff --json' "$guide"
