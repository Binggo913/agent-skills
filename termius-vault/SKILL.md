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

Operate only on the current user's local Termius vault. Run commands from this
skill directory; stdout is JSON and diagnostics go to stderr.

## Choose the shortest workflow

```bash
scripts/termius.sh export                         # JSON; secrets omitted
scripts/termius.sh export-ssh ~/.ssh               # Termius → WSL/local SSH config
scripts/termius.sh export-ssh /mnt/c/Users/<user>/.ssh --keys --platform windows
scripts/termius.sh verify                         # host → identity → auth; passwords omitted
scripts/termius.sh import ~/.ssh --dry-run         # compare with current vault; no record writes
scripts/termius.sh import ~/.ssh /mnt/c/Users/<user>/.ssh  # merge sources in one lifecycle
scripts/termius.sh push <spec.json>                # add missing hosts + referenced keys
scripts/termius.sh batch <plan.json>               # multiple operations, one managed lifecycle
```

- Specify the reverse destination explicitly; `~/.ssh` in WSL is not Windows
  or Mac home. Private-key writes require `--keys`; passwords are never saved.
- Run `doctor` only for setup or diagnosis, not before every operation.
- For Termius writes, use the returned `verified` mappings instead of launching another
  `verify`. They confirm local records, not successful SSH login or cloud sync.
- Combine sources into one `import`. For multiple vault operations, use `batch`;
  do not repeatedly invoke export/dry-run/push/verify in separate app cycles.
- Use `--dry-run` when an actual vault comparison is needed. For source-only
  preview without starting Termius, see [import guidance](references/import.md).

## Safety and application state

- Do not add `--restart` without permission to close Termius and its active SSH
  sessions. Reads reuse an existing CDP instance; otherwise a running app is
  left alone unless restart is authorized.
- Termius writes require a successful stopped-database backup. Add-only matching uses
  labels, not key fingerprints: existing hosts/keys are not updated or deleted.
- By default, close only the debugging instance managed by this task. Read-only
  tasks restore the initial open/closed state. Termius writes start normal mode once at
  the end to allow refresh/sync. Startup may still show the Termius window.
- `--keep-debug` is explicit opt-in for cross-command reuse, not a default fix
  for flashing: CDP permits local vault access. Close/restart normally afterward.
- Reverse export preserves existing aliases/key contents and backs up configs
  before adding an Include. It does not overwrite conflicts or copy login passwords.
- Raw `export --keys` includes linked keys but no login passwords or passphrases;
  `export --secrets` also includes passwords/passphrases. Do not echo/commit credential JSON.
- macOS is **theoretical, not verified**: assess the actual machine and read the
  reverse reference. Do not assume Windows vault/keychain glue works on a Mac.
- Scripts use local IPC; Termius itself may sync data online after restart.

## Read only the reference needed

- [Commands, batch schema, lifecycle, recovery](references/commands.md): advanced
  options, JSON/YAML specs, restart behavior, or troubleshooting.
- [Reverse export and macOS assessment](references/export-ssh.md): destinations,
  private-key authorization, ACLs, saved JSON, and theoretical Mac workflows.
- [SSH-config import](references/import.md): filters, path handling, parser limits.
- [Vault format](references/termius-format.md): implementation/upgrade diagnosis
  only; not needed for ordinary export, import, or verification.
