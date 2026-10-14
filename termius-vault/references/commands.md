# Commands, Termius lifecycle, and recovery

Run from the skill directory. For OpenSSH source handling use [import.md](import.md);
for target SSH files and theoretical macOS use [export-ssh.md](export-ssh.md).
This reference owns live Termius lifecycle, push/batch formats, and recovery.

## Command selection

| Command | Result | Record writes |
|---|---|---|
| `doctor` | Runtime, crypto, credential and process checks; no GUI launch | No |
| `export` | JSON hosts/known_hosts; `--keys` adds linked keys, `--secrets` also passwords/passphrases | No |
| `export-ssh <target>` | OpenSSH configs; `--keys` permits private-key files | Target .ssh only |
| `verify` | Host/address/port/user/auth mapping; never prints passwords | No |
| `push <spec>` | Inserted entries, verified local mappings, backup path | Add-only |
| `import <source>...` | Same result as push; merges sources before app access | Add-only |
| `push/import --dry-run` | Existing labels, missing host labels, required key names | No |
| `batch <plan>` | Results in operation order; one managed application lifecycle | Per operation |

`--restart` allows closing active Termius/SSH sessions if required. It is not
needed when Termius is closed. An existing debugging instance can be borrowed
for reads and no-op pushes without restart. An actual Termius record write
requires a stopped-database backup and therefore restart permission.

`--keep-debug` retains a successfully started debugging instance for later
commands. It also defers the final write refresh/sync restart. This is opt-in:
local processes can access the vault through CDP. Close it or restart Termius
normally when done. A failed managed operation attempts normal cleanup even
when this flag was supplied.

`--secrets` and raw `--keys` are accepted by export; reverse export also accepts
`--keys` as private-key write authorization. Export includes credentials linked to
hosts, not a complete inventory of unreferenced keys. Treat the output as
sensitive. JSON is dependency-free; YAML input additionally requires PyYAML.

Environment: `TERMIUS_EXE` overrides the Windows executable path;
`TERMIUS_CDP_PORT` overrides the loopback debugging port (default 9222).

## Push spec

```json
{
  "keys": {
    "work": { "private_key_file": "~/.ssh/id_ed25519_work" }
  },
  "hosts": [
    { "label": "build", "address": "192.0.2.10", "port": 2201,
      "user": "alice", "key": "work" }
  ]
}
```

Use either `key` or `password` per host. Omitted port defaults to 22.
`private_key_file` is expanded on the WSL side, and an available `.pub` sibling
supplies the public key. Alternatively supply `private_key`, `public_key`, and
`passphrase` inline. Prefer absolute or `~` paths for key files; relative key
paths use the driver's working directory.

Existing hosts match by label; existing keys match by key label. Different key
material under the same name is **not** compared or replaced. Only keys used by
new hosts are inserted; duplicate host labels within one spec are rejected.
See [JSON](examples/desired.example.json) and [YAML](examples/desired.example.yaml)
examples. Do not substitute real credentials into tracked examples.

## Batch: avoid repeated startup/shutdown

```json
{
  "operations": [
    { "command": "push", "desired": "desired.local.json" },
    { "command": "export" }
  ]
}
```

The example combines a requested write and inventory export; it is not a
required post-write checklist. A single import/push does not need a batch.
Run `scripts/termius.sh batch "<plan.json>"`, adding `--restart` only when closing
existing sessions has been authorized. Supported operations: `export`,
`verify`, `push`. An export operation can explicitly set
`"keys": true` or `"secrets": true`; a push can set `"dryRun": true`. A desired spec
may be inline or a file path relative to the plan. SSH imports instead accept
multiple sources directly;
there is no need to create one batch operation per source.

One batch reads the local key once, shares one CDP connection, and takes at
most one physical backup. If the app must start for a write batch, back up
before that first start. If borrowing an existing CDP instance, reads/no-ops do
not interrupt it; before the first actual write, stop → backup → start CDP.
Further writes reuse that backup and connection. Refresh/sync startup happens
once after the whole batch, not after each write. Operations execute in order;
a dry-run does not grant permission or conditionally skip later operations.

## Application lifecycle and visual limits

The following table concerns the Termius source app. Reverse `export-ssh` is a
**read** of Termius even when it writes target `.ssh` files. `--from` output
never starts Termius. Target-file behavior belongs to [export-ssh.md](export-ssh.md).

| Initial state | Termius reads (including reverse export) | Termius record writes |
|---|---|---|
| Closed | Start CDP once; close at end; remain closed | Backup before start; start CDP once; normal startup at end |
| Running normally | Refuse without `--restart`; if authorized, one CDP cycle then normal startup | Require `--restart`; stop/backup once, one CDP cycle, normal startup at end |
| Running with usable CDP | Reuse; do not stop it | No-op reuses; actual write requires `--restart` for backup, then one final normal startup |

With `--keep-debug`, a successfully managed task instead leaves CDP running.
The driver hides helper console windows, removes fixed post-kill delays, waits
for a ready background target, and requests graceful CDP shutdown where
supported before force-stop fallback. This reduces repeated flashes; it is
**not a headless Termius implementation** and does not promise invisible GUI
startup. Do not modify Termius's installed files to hide its windows.

For Termius record writes, local verification checks address, port, username
and auth binding.
It does not prove cloud sync, native UI visibility, or successful SSH login.
Those writes span separate IndexedDB databases and are not atomic across the full
record graph: a failure can leave partial additions. Do not blindly retry.

## Termius backups, temporary files, and recovery

The backup is `%APPDATA%/Termius-backup-<timestamp>-<pid>/IndexedDB`. Failure to
stop the app or copy the database aborts Termius writes. Backups contain
encrypted credentials; keep them private. A confirmed closed app may be backed up even
if the later comparison finds no missing hosts, avoiding an extra GUI cycle.

Prepared plaintext specs live in a unique Windows temp directory, restricted
at creation where filesystem permissions support it, and are removed on normal
exit, failure, or handled interruption. WSL modes alone are not a Windows ACL
guarantee; rely on the Windows user's private temp directory and clean up after
forced termination. No rollback or automatic backup deletion is performed.

On a partial write, retain the reported backup and inspect local mappings
before retrying. For full local restoration: obtain permission to close
Termius, back up the failed current IndexedDB too, replace IndexedDB from the
chosen backup while the app is confirmed stopped, then start normally and
verify. Cloud-synced changes are a separate concern; restoring local files is
not a cloud rollback.

## Troubleshooting

- Credential missing: open/sign in to Termius under the intended Windows account;
  use `doctor` to check. Do not print the local key.
- App running without CDP: request permission before `--restart`; it may close
  SSH sessions. Prefer one merged import/batch instead of repeated restarts.
- CDP port occupied or background target not ready: do not attach to another
  browser. Wait for startup or choose a free `TERMIUS_CDP_PORT`.
- `.termius-vault-lock` exists under `%APPDATA%/Termius`: another operation may be
  active. Confirm no controller is running before manually removing a stale
  empty lock directory. Never remove it merely to force a concurrent run.
- Startup/evaluation failure: managed cleanup is attempted; confirm the app's
  state and that no debugging instance remains if cleanup also fails.
- Upgrade/schema failure: consult [termius-format.md](termius-format.md).
  The format is reverse-engineered, not a supported stable API.
