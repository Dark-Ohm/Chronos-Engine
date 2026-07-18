#!/usr/bin/env sh
set -eu

repo="$(mktemp -d)"
trap 'rm -rf "$repo"' EXIT
philip_bin="$PWD/bin/philip.js"
git -C "$repo" init -b main >/dev/null 2>&1 || { git -C "$repo" init >/dev/null; git -C "$repo" checkout -B main >/dev/null; }
git -C "$repo" config user.name "Philip Test"
git -C "$repo" config user.email "philip@example.invalid"
printf '# Example\n' > "$repo/README.md"
git -C "$repo" add README.md
git -C "$repo" commit -m "Initial commit" >/dev/null

(cd "$repo" && node "$philip_bin" --robot-triage) > "$repo/stdout" 2> "$repo/stderr"
test ! -s "$repo/stderr"
test ! -e "$repo/.philip/artifacts"
jq -e '
  .tool == "philip"
  and .contractVersion == 2
  and .artifactStore.path == ".philip/artifacts"
  and .artifactStore.exists == false
  and .currentDiffArtifactPath == null
  and .latestDiffArtifactPath == null
  and (.verification.commandsDiscovered | index("npm run check"))
  and .verification.commandsRun == []
  and .exitCodes["2"] == "user-input-error"
' "$repo/stdout" >/dev/null

if (cd "$repo" && node "$philip_bin" --robot-triage --bad) > "$repo/bad.stdout" 2> "$repo/bad.stderr"; then
  echo "expected --robot-triage --bad to fail" >&2
  exit 1
fi
test ! -s "$repo/bad.stdout"
grep -q 'Unknown option: --bad' "$repo/bad.stderr"
grep -q 'philip --robot-triage' "$repo/bad.stderr"
