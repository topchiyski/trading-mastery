#!/usr/bin/env bash
# PostToolUse hook (Edit|Write|MultiEdit): format the touched file with Prettier,
# then apply ESLint autofixes for JS/TS. Never blocks the edit: always exits 0.
set -u

root="${CLAUDE_PROJECT_DIR:-$(cd "$(dirname "$0")/../.." && pwd)}"
cd "$root" || exit 0

# Extract tool_input.file_path from the hook JSON on stdin (node: no jq dependency).
file="$(node -e '
  let s = "";
  process.stdin.on("data", (d) => (s += d));
  process.stdin.on("end", () => {
    try { process.stdout.write(JSON.parse(s)?.tool_input?.file_path ?? ""); } catch {}
  });
')"

[ -n "$file" ] || exit 0
[ -f "$file" ] || exit 0

case "$file" in
  *node_modules*|*/data/*|*\\data\\*) exit 0 ;;
esac

bin="$root/node_modules/.bin"
[ -x "$bin/prettier" ] || exit 0

case "$file" in
  *.ts|*.tsx|*.js|*.jsx|*.mjs|*.cjs)
    "$bin/prettier" --write --log-level warn "$file" >&2 || true
    "$bin/eslint" --fix --no-warn-ignored "$file" >&2 || true
    ;;
  *.json|*.css|*.md|*.html|*.yml|*.yaml)
    "$bin/prettier" --write --log-level warn "$file" >&2 || true
    ;;
esac

exit 0
