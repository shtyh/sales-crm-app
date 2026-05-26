#!/usr/bin/env bash
#
# update-context.sh — daily "what I did today" → CLAUDE.md, then resume
# the most recent Claude Code conversation.
#
# Usage:
#   ./update-context.sh                 # opens $EDITOR for multi-line input
#   echo "shipped X" | ./update-context.sh
#   ./update-context.sh "shipped X"     # one-line note as arg
#
# What it does:
#   1. Prompts for today's progress (via $EDITOR, stdin, or argv).
#   2. Appends a "## YYYY-MM-DD HH:MM — progress" section with the note
#      to ./CLAUDE.md (or ../CLAUDE.md if launched from a subdir).
#   3. Hands off to `claude --continue`, which picks up the most recent
#      conversation; the new turn will read the updated CLAUDE.md.
#
# IMPORTANT — /clear:
#   /clear is a slash command that runs *inside* an active Claude Code
#   session. There's no way for a shell script (which is a child process)
#   to inject /clear into a running or about-to-start session. So this
#   script CANNOT programmatically clear the conversation.
#   Two practical alternatives if you want a clean slate:
#     a) Type `/clear` yourself once Claude opens.
#     b) Replace the `claude --continue` line at the bottom with `claude`
#        (no flags) — starts a brand-new conversation that picks up the
#        updated CLAUDE.md as initial context, which is functionally the
#        same as "/clear then continue".

set -euo pipefail

# ── 1. Always append to the project's CLAUDE.md, regardless of cwd ────────
# Resolve relative to this script's own location so `./update-context.sh`,
# `bash update-context.sh`, and `~/sales-crm-app/update-context.sh` all
# write to the same file.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTEXT_FILE="$SCRIPT_DIR/CLAUDE.md"

if [[ ! -f "$CONTEXT_FILE" ]]; then
  echo "update-context: expected $CONTEXT_FILE to exist" >&2
  exit 1
fi

# ── 2. Read the progress note ─────────────────────────────────────────────
# Three modes, in priority order:
#   • argv[1+]      — one-line note (`./update-context.sh "shipped X"`).
#   • stdin if piped — `echo "..." | ./update-context.sh`.
#   • $EDITOR       — opens a tempfile with helper comments.
#   • Fallback      — reads stdin until Ctrl-D on an interactive terminal.

TMP_NOTE="$(mktemp -t update-context.XXXXXX)"
trap 'rm -f "$TMP_NOTE"' EXIT

if [[ $# -gt 0 ]]; then
  printf '%s\n' "$*" > "$TMP_NOTE"
elif [[ ! -t 0 ]]; then
  cat > "$TMP_NOTE"
elif [[ -n "${EDITOR:-}" ]]; then
  cat <<'BANNER' > "$TMP_NOTE"
# Today's progress notes. Lines starting with `#` are dropped before
# saving. Save and quit to commit; quit without saving to abort.

BANNER
  "$EDITOR" "$TMP_NOTE"
else
  echo "update-context: enter today's progress. Press Ctrl-D on a blank line when done." >&2
  cat > "$TMP_NOTE"
fi

# Strip leading '# ...' comment lines (so the EDITOR-mode banner doesn't
# leak into the saved note). Then trim leading/trailing blank lines.
NOTE="$(
  sed '/^# /d' "$TMP_NOTE" \
    | awk 'NF { p=1 } p { print }' \
    | awk '{lines[NR]=$0} END { for (i=NR; i>0; i--) if (lines[i] ~ /[^[:space:]]/) { last=i; break } for (i=1; i<=last; i++) print lines[i] }'
)"

if [[ -z "$NOTE" ]]; then
  echo "update-context: empty note — nothing appended, skipping Claude launch." >&2
  exit 0
fi

# ── 3. Append a dated section to CLAUDE.md ────────────────────────────────
TS="$(date '+%Y-%m-%d %H:%M')"
{
  echo ""
  echo "## $TS — progress"
  echo ""
  echo "$NOTE"
} >> "$CONTEXT_FILE"

LINES="$(printf '%s\n' "$NOTE" | wc -l | tr -d ' ')"
echo "update-context: appended $LINES line(s) under '## $TS' in $CONTEXT_FILE" >&2

# ── 4. Hand off to Claude Code ────────────────────────────────────────────
# exec replaces this shell so Claude inherits the terminal cleanly.
# Swap to `exec claude` (no --continue) if you want a fresh conversation.
exec claude --continue
