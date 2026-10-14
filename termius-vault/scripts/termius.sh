#!/usr/bin/env bash
# termius.sh - driver for the `termius-vault` skill.
#
# Runs in WSL/Linux and bridges to the Windows-side Node controller
# (scripts/win/termius-ctl.js) using Termius' own Electron runtime, so no
# separate Node.js install is required on the Windows host.
#
# Usage:
#   termius.sh doctor
#   termius.sh export [--secrets] [--restart]
#   termius.sh verify [--restart]
#   termius.sh push <spec.json|yaml> [--dry-run]
#
# Environment:
#   TERMIUS_EXE          full Windows path to Termius.exe (optional)
#   TERMIUS_CDP_PORT     CDP port, default 9222
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CTL_JS="$SCRIPT_DIR/win/termius-ctl.js"

die() { echo "termius.sh: $*" >&2; exit 1; }

CMD=""
if command -v cmd.exe >/dev/null 2>&1; then
  CMD="cmd.exe"
elif [[ -x /mnt/c/Windows/System32/cmd.exe ]]; then
  CMD="/mnt/c/Windows/System32/cmd.exe"
else
  die "cmd.exe not found (run inside WSL with Windows interop enabled)"
fi
command -v wslpath >/dev/null 2>&1 || die "wslpath not found"

WIN_LOCALAPPDATA="$("$CMD" /c 'echo %LOCALAPPDATA%' 2>/dev/null | tr -d '\r')"
[[ -n "$WIN_LOCALAPPDATA" ]] || die "could not determine %LOCALAPPDATA%"
WIN_EXE="${TERMIUS_EXE:-$WIN_LOCALAPPDATA\\Programs\\Termius\\Termius.exe}"
WIN_TEMP="$WIN_LOCALAPPDATA\\Temp"
UNIX_TEMP="$(wslpath -u "$WIN_TEMP")"
[[ -d "$UNIX_TEMP" ]] || die "Windows temp dir not reachable: $WIN_TEMP"

CTL_WIN="$(wslpath -w "$CTL_JS")"

# ------------------------------------------------------------------ args
cmd="${1:-}"; shift || true
args=()

expand_desired() {  # $1 = spec path -> prints Windows path of inlined JSON
  local spec="$1"
  [[ -f "$spec" ]] || die "spec not found: $spec"
  local out_unix="$UNIX_TEMP/termius-desired-$$.json"
  python3 "$SCRIPT_DIR/prepare_desired.py" "$spec" "$out_unix"
  wslpath -w "$out_unix"
}

case "$cmd" in
  push)
    desired=""
    rest=()
    while [[ $# -gt 0 ]]; do
      case "$1" in
        --desired) desired="$2"; shift 2 ;;
        --desired=*) desired="${1#*=}"; shift ;;
        --dry-run|--restart|--secrets) rest+=("$1"); shift ;;
        -*) die "unknown flag: $1" ;;
        *) if [[ -z "$desired" ]]; then desired="$1"; else die "unexpected arg: $1"; fi; shift ;;
      esac
    done
    [[ -n "$desired" ]] || die "push requires a spec file"
    desired_win="$(expand_desired "$desired")"
    args=("push" "--desired" "$desired_win" "${rest[@]}")
    ;;
  export)
    args=("export")
    for a in "$@"; do args+=("$a"); done
    ;;
  verify|doctor)
    args=("$cmd")
    for a in "$@"; do args+=("$a"); done
    ;;
  ""|-h|--help|help)
    sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
    exit 0
    ;;
  *) die "unknown command: $cmd" ;;
esac

# ------------------------------------------------------------------ run
BAT_WIN="$WIN_TEMP\\termius-ctl-run-$$.bat"
BAT_UNIX="$(wslpath -u "$BAT_WIN")"
cleanup() { rm -f "$BAT_UNIX" "$UNIX_TEMP/termius-desired-$$.json" 2>/dev/null || true; }
trap cleanup EXIT

{
  printf '@echo off\r\n'
  printf 'set ELECTRON_RUN_AS_NODE=1\r\n'
  printf 'set "TERMIUS_EXE=%s"\r\n' "$WIN_EXE"
  printf '"%%TERMIUS_EXE%%" "%s"' "$CTL_WIN"
  for a in "${args[@]}"; do printf ' "%s"' "$a"; done
  printf '\r\n'
} > "$BAT_UNIX"

TERMIUS_EXE="$WIN_EXE" "$CMD" /c "$BAT_WIN"
