---
name: termius-vault
description: Inspect, export, verify, or add local Termius SSH hosts and credentials on Windows from WSL. Use for vault backups, SSH-config migration, and host-to-key troubleshooting; not for connecting to servers.
license: MIT
compatibility: Requires Windows Termius desktop and WSL interop, Python 3, cmd.exe, and wslpath. Uses Termius's bundled runtime. macOS access is not implemented.
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
scripts/termius.sh export                         # hosts + known_hosts; secrets omitted
scripts/termius.sh verify                         # host → identity → auth; passwords omitted
scripts/termius.sh import ~/.ssh --dry-run         # compare with current vault; no record writes
scripts/termius.sh import ~/.ssh /mnt/c/Users/<user>/.ssh  # merge sources in one lifecycle
scripts/termius.sh push <spec.json>                # add missing hosts + referenced keys
scripts/termius.sh batch <plan.json>               # multiple operations, one managed lifecycle
```

- Run `doctor` only for setup or diagnosis, not before every operation.
- For writes, use the returned `verified` mappings instead of launching another
  `verify`. They confirm local records, not successful SSH login or cloud sync.
- Combine sources into one `import`. For multiple vault operations, use `batch`;
  do not repeatedly invoke export/dry-run/push/verify in separate app cycles.
- Use `--dry-run` when an actual vault comparison is needed. For source-only
  preview without starting Termius, see [import guidance](references/import.md).

## Safety and application state

- Do not add `--restart` without permission to close Termius and its active SSH
  sessions. Reads reuse an existing CDP instance; otherwise a running app is
  left alone unless restart is authorized.
- Writes require a successful stopped-database backup. Add-only matching uses
  labels, not key fingerprints: existing hosts/keys are not updated or deleted.
- By default, close only the debugging instance managed by this task. Read-only
  tasks restore the initial open/closed state. Writes start normal mode once at
  the end to allow refresh/sync. Startup may still show the Termius window.
- `--keep-debug` is explicit opt-in for cross-command reuse, not a default fix
  for flashing: CDP permits local vault access. Close/restart normally afterward.
- Only `export --secrets` may print passwords, linked private keys, and
  passphrases. Do not echo, commit, or retain plaintext credentials unnecessarily.
- Scripts use local IPC; Termius itself may sync data online after restart.

## Read only the reference needed

- [Commands, batch schema, lifecycle, recovery](references/commands.md): advanced
  options, JSON/YAML specs, restart behavior, or troubleshooting.
- [SSH-config import](references/import.md): filters, path handling, parser limits.
- [Vault format](references/termius-format.md): implementation/upgrade diagnosis
  only; not needed for ordinary export, import, or verification.
