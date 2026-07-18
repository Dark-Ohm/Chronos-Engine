#!/usr/bin/env sh
set -eu

tmp="$(mktemp)"
trap 'rm -f "$tmp" "$tmp.out" "$tmp.err"' EXIT
sed 's/Confidence: High/Confidence: Banana/' fixtures/audit-lint/pass.md > "$tmp"

if node bin/philip.js lint-audit "$tmp" --json > "$tmp.out" 2> "$tmp.err"; then
  echo "expected invalid confidence to fail" >&2
  exit 1
fi
test ! -s "$tmp.err"
jq -e '.ok == false and any(.issues[]; .code == "INVALID_CONFIDENCE_LABEL")' "$tmp.out" >/dev/null
