#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
NODE="$(command -v node)" || { osascript -e 'display alert "Codex Theme Studio" message "需要 Node.js 22 或更高版本。" as critical'; exit 1; }

if "$NODE" "$SCRIPT_DIR/theme.mjs" web 2>"${TMPDIR:-/tmp}/codex-theme-studio-open.log"; then
  exit 0
fi

MESSAGE="$(tail -n 8 "${TMPDIR:-/tmp}/codex-theme-studio-open.log" 2>/dev/null || true)"
if [[ "$MESSAGE" == *"already running without Theme Studio CDP"* ]]; then
  ANSWER="$(osascript <<'APPLESCRIPT'
display dialog "Codex 当前未开启安全的本地主题接口，需要重启一次。之后切换主题不再需要重启。" with title "Codex Theme Studio" buttons {"取消", "重启并打开"} default button "重启并打开" cancel button "取消"
return button returned of result
APPLESCRIPT
)" || exit 0
  [[ "$ANSWER" == "重启并打开" ]] || exit 0
  exec "$NODE" "$SCRIPT_DIR/theme.mjs" web --restart-existing
fi

osascript - "${MESSAGE:-无法打开主题库。}" <<'APPLESCRIPT' 2>/dev/null || true
on run argv
  display alert "Codex Theme Studio" message (item 1 of argv) as critical
end run
APPLESCRIPT
exit 1
