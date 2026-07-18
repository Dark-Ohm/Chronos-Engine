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

if node "$PWD/bin/philip.js" diff --bad > "$repo/stdout" 2> "$repo/stderr"; then
  echo "expected philip diff --bad to fail" >&2
  exit 1
fi
test ! -s "$repo/stdout"
grep -q 'Unknown option: --bad' "$repo/stderr"
grep -q 'philip diff --help' "$repo/stderr"
test ! -e "$repo/.philip/artifacts"
