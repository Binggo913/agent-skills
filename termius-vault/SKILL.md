---
name: termius-vault
description: Move SSH hosts and keys between Termius and OpenSSH .ssh directories, inspect vaults, and diagnose host-to-key bindings. Windows vault access uses WSL; macOS needs machine-specific assessment. Not for server login.
license: MIT
compatibility: Windows vault access needs Termius desktop, WSL interop, Python 3.8+, cmd.exe, and wslpath; no separate Windows Node install. Reverse output also accepts saved JSON. macOS is theoretical and requires assessment on the actual machine.
disable-model-invocation: true
metadata:
  platform: windows
  category: ssh
---

# Termius Vault

Operate on the current user's own data. Run helpers from this skill directory;
stdout is JSON, diagnostics go to stderr. Read only the reference for the task.

## Select the operation

| Task | Entry command | Read when needed |
|---|---|---|
| OpenSSH → Termius | `scripts/termius.sh import <source>...` | [Import sources, filtering, parser limits](references/import.md) |
| Termius → OpenSSH | `scripts/termius.sh export-ssh <target-.ssh-dir>` | [Reverse output, keys, saved JSON, macOS](references/export-ssh.md) |
| JSON export or binding inspection | `scripts/termius.sh export` / `verify` | [Commands and lifecycle](references/commands.md) |
| Spec-based additions or several requested operations | `scripts/termius.sh push <spec>` / `batch <plan>` | [Spec and batch formats](references/commands.md) |
| Implementation/upgrade diagnosis only | Inspect affected source | [Vault format](references/termius-format.md) |

## Direct CLI

Run from this skill directory; the examples are separate tasks, not a sequence:

```bash
scripts/termius.sh import "$HOME/.ssh"                                  # OpenSSH -> Termius
scripts/termius.sh export-ssh "$HOME/.ssh"                              # Termius -> WSL SSH config
scripts/termius.sh export-ssh "/mnt/c/Users/<WindowsUser>/.ssh" \
  --platform windows --keys                                            # + authorized private keys
```

YAML specs additionally need PyYAML. Windows output uses Windows ACLs;
WSL/Linux output uses POSIX permissions. Existing entries are not automatically
updated or replaced.

## Essential boundaries

- The live vault bridge is Windows Termius via WSL. Reverse output can instead
  consume existing JSON via `--from`. **macOS is theoretical, unverified**:
  assess the machine using the reverse reference, not Windows-specific glue.
- Specify the source/target machine and reverse destination. WSL's `~/.ssh` is
  not Windows or Mac home. Reverse private-key writes need `--keys`; SSH output
  does not store exported login passwords or key passphrases.
- Closing Termius/active sessions needs permission before `--restart`. Default
  reads restore initial app state or reuse existing CDP. `--keep-debug` is an
  explicit opt-in: it leaves local vault access exposed through CDP.
- Termius writes require a stopped-database backup and only add missing labels;
  existing key labels are not fingerprint comparisons. Reverse writes preserve
  existing aliases/key contents and back up config changes. Do not silently
  overwrite conflicts, discard backups, or assume automatic rollback.
- Raw `export --keys` exposes linked keys; `export --secrets` also exposes
  passwords/passphrases. Require authorization; do not echo/commit secrets.
  Termius itself may sync online even though the helpers use local IPC.

## Keep the workflow short

Merge SSH sources into one `import`; use `batch` for multiple actual operations.
`doctor` and `--dry-run` are for relevant setup/diagnosis/comparison, not a fixed
checklist. Termius writes already return `verified` mappings; do not relaunch a
separate verification without a reason. Local results do not establish native
UI acceptance, cloud sync, or successful SSH login.
