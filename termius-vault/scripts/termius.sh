#!/usr/bin/env bash
# WSL driver. Run --help without Windows interop or any vault access.
set -euo pipefail
umask 077
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
die() { echo "termius.sh: $*" >&2; exit 1; }
usage() {
  cat <<'USAGE'
Usage:
  termius.sh doctor
  termius.sh export [--secrets|--keys] [--restart] [--keep-debug]
  termius.sh export-ssh <target-.ssh-dir> [--keys] [--dry-run] [--platform auto|posix|windows|macos]
                        [--from <export.json>] [--only GLOB] [--exclude GLOB] [--restart]
  termius.sh verify [--restart] [--keep-debug]
  termius.sh push <spec.json|yaml> [--dry-run] [--restart] [--keep-debug]
  termius.sh import <config|.ssh-dir>... [--only GLOB] [--exclude GLOB] [--dry-run] [--restart] [--keep-debug]
  termius.sh batch <plan.json|yaml> [--restart] [--keep-debug]

--restart     Permit closing Termius (including active SSH sessions) when needed.
--keep-debug  Opt in to leaving this task's debugging instance open for reuse.
              CDP exposes vault access; close it or restart normally afterward.

Env: TERMIUS_EXE (full Windows path), TERMIUS_CDP_PORT (default 9222).
See references/commands.md for the batch schema and lifecycle details.
USAGE
}
cmd="${1:-}"; shift || true
case "$cmd" in ""|-h|--help|help) usage; exit 0 ;; esac
sources=(); flags=(); filters=(); writer=(); spec=""; offline=false; with_keys=false
while [[ $# -gt 0 ]]; do
  case "$1" in
    --restart|--keep-debug) flags+=("$1"); shift ;;
    --keys)
      [[ "$cmd" == export || "$cmd" == export-ssh ]] || die "--keys is only valid for export/export-ssh"
      if [[ "$cmd" == export ]]; then flags+=("$1"); else writer+=("$1"); with_keys=true; fi
      shift ;;
    --from|--platform)
      [[ "$cmd" == export-ssh && $# -ge 2 && "$2" != --* ]] || die "invalid $1"
      [[ "$1" != --from ]] || offline=true
      writer+=("$1" "$2"); shift 2 ;;
    --secrets) [[ "$cmd" == export ]] || die "--secrets is only valid for export"; flags+=("$1"); shift ;;
    --dry-run)
      [[ "$cmd" == push || "$cmd" == import || "$cmd" == export-ssh ]] || die "--dry-run is only valid for push/import/export-ssh"
      if [[ "$cmd" == export-ssh ]]; then writer+=("$1"); else flags+=("$1"); fi
      shift ;;
    --only|--exclude)
      [[ "$cmd" == import || "$cmd" == export-ssh ]] || die "$1 is only valid for import/export-ssh"
      [[ $# -ge 2 && "$2" != --* ]] || die "missing value for $1"
      filters+=("$1" "$2"); shift 2 ;;
    --only=*|--exclude=*) [[ "$cmd" == import || "$cmd" == export-ssh ]] || die "filter only valid for import/export-ssh"; filters+=("$1"); shift ;;
    --desired)
      [[ "$cmd" == push && $# -ge 2 && "$2" != --* && -z "$spec" ]] || die "invalid --desired"
      spec="$2"; shift 2 ;;
    --desired=*) [[ "$cmd" == push && -z "$spec" ]] || die "invalid --desired"; spec="${1#*=}"; shift ;;
    -*) die "unknown flag: $1" ;;
    *)
      if [[ "$cmd" == import ]]; then sources+=("$1")
      elif [[ "$cmd" == push || "$cmd" == batch || "$cmd" == export-ssh ]]; then
        [[ -z "$spec" ]] || die "unexpected extra argument"
        spec="$1"
      else die "unexpected argument"; fi
      shift ;;
  esac
done
case "$cmd" in
  push|batch) [[ -f "$spec" ]] || die "$cmd requires an existing spec/plan file" ;;
  import) [[ ${#sources[@]} -gt 0 ]] || die "import requires at least one SSH config or directory" ;;
  doctor) [[ ${#flags[@]} -eq 0 ]] || die "doctor takes no flags" ;;
  export-ssh) [[ -n "$spec" ]] || die "export-ssh requires an explicit destination directory" ;;
  export|verify) ;;
  *) die "unknown command: $cmd" ;;
esac

if [[ "$cmd" == export-ssh && "$offline" == true ]]; then
  [[ ${#flags[@]} -eq 0 ]] || die "--from does not use Termius; omit restart/debug flags"
  exec python3 "$SCRIPT_DIR/vault_to_ssh.py" "$spec" "${writer[@]}" "${filters[@]}"
fi

CMD="$(command -v cmd.exe || true)"
[[ -n "$CMD" ]] || CMD=/mnt/c/Windows/System32/cmd.exe
[[ -x "$CMD" ]] || die "live vault access needs Windows interop; on macOS assess references/export-ssh.md and use --from or adapt the local bridge"
command -v wslpath >/dev/null 2>&1 || die "wslpath not found"
WIN_LOCALAPPDATA="$( (cd /mnt/c 2>/dev/null || true; "$CMD" /d /c 'echo %LOCALAPPDATA%' 2>/dev/null) | tr -d '\r')"
[[ -n "$WIN_LOCALAPPDATA" && "$WIN_LOCALAPPDATA" != *%* ]] || die "could not determine LOCALAPPDATA"
WIN_EXE="${TERMIUS_EXE:-$WIN_LOCALAPPDATA\\Programs\\Termius\\Termius.exe}"
UNIX_TEMP="$(wslpath -u "$WIN_LOCALAPPDATA\\Temp")"
[[ -d "$UNIX_TEMP" ]] || die "Windows temp directory is not reachable"
# Register cleanup BEFORE parsing/expanding specs, including failed preparation.
WORK="$(mktemp -d "$UNIX_TEMP/termius-vault.XXXXXXXX")"
cleanup() { rm -f "$WORK/run.bat" "$WORK/desired.json" "$WORK/import.json"; rmdir "$WORK"; }
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

case "$cmd" in
  push) python3 "$SCRIPT_DIR/prepare_desired.py" "$spec" "$WORK/desired.json"
    args=(push --desired "$(wslpath -w "$WORK/desired.json")") ;;
  import)
    python3 "$SCRIPT_DIR/sshconfig_to_spec.py" "${filters[@]}" "${sources[@]}" > "$WORK/import.json"
    python3 "$SCRIPT_DIR/prepare_desired.py" "$WORK/import.json" "$WORK/desired.json"
    args=(push --desired "$(wslpath -w "$WORK/desired.json")") ;;
  batch) python3 "$SCRIPT_DIR/prepare_desired.py" --batch "$spec" "$WORK/desired.json"
    args=(batch --file "$(wslpath -w "$WORK/desired.json")") ;;
  export-ssh) args=(export); [[ "$with_keys" == false ]] || args+=(--keys) ;;
  *) args=("$cmd") ;;
esac
args+=("${flags[@]}")
CTL_WIN="$(wslpath -w "$SCRIPT_DIR/win/termius-ctl.js")"
# Escape percent expansion in .bat paths; delayed expansion is disabled.
bat_escape() { local value="$1"; printf '%s' "${value//%/%%}"; }
{
  printf '@echo off\r\nsetlocal DisableDelayedExpansion\r\nset ELECTRON_RUN_AS_NODE=1\r\n'
  printf 'set "TERMIUS_EXE=%s"\r\n' "$(bat_escape "$WIN_EXE")"
  printf '"%%TERMIUS_EXE%%" "%s"' "$(bat_escape "$CTL_WIN")"
  for arg in "${args[@]}"; do printf ' "%s"' "$(bat_escape "$arg")"; done
  printf '\r\n'
} > "$WORK/run.bat"
if [[ "$cmd" == export-ssh ]]; then
  # Credentials stream directly to the writer; never create a plaintext vault dump.
  (cd "$UNIX_TEMP"; TERMIUS_EXE="$WIN_EXE" "$CMD" /d /c "$(wslpath -w "$WORK/run.bat")") |
    python3 "$SCRIPT_DIR/vault_to_ssh.py" "$spec" "${writer[@]}" "${filters[@]}"
else
  (cd "$UNIX_TEMP"; TERMIUS_EXE="$WIN_EXE" "$CMD" /d /c "$(wslpath -w "$WORK/run.bat")")
fi
