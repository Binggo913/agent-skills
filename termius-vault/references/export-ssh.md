# Termius → OpenSSH

## Choose the actual destination

Run from the skill directory. A destination is mandatory to avoid mixing the
WSL home with the Windows user's home:

```bash
scripts/termius.sh export-ssh ~/.ssh
scripts/termius.sh export-ssh /mnt/c/Users/<user>/.ssh --platform windows --keys
```

Default: write connection metadata only. `--keys` explicitly authorizes saving
host-linked private keys. Without it, key-based entries report that IdentityFile
still needs configuring. Login passwords and stored key passphrases are never
written; encrypted key contents remain encrypted and authentication may prompt.
No SSH connection is attempted.

`--only` / `--exclude` are repeatable/comma-separated label glob filters.
`--dry-run` reports additions/skips without creating any target directory or
files. Use it when a destination comparison is useful, not as a mandatory step.
A live-source export reads Termius once and streams JSON directly to the writer;
it does not create an intermediate plaintext vault dump. Usual `--restart` and
`--keep-debug` permissions apply to that source read.

## File behavior

- Keep existing connection blocks intact. Prepend a single quoted, absolute
  Include for `config.termius`; put generated hosts there. Generic `Host *`
  defaults remain usable. Existing aliases/specific Host patterns are skipped.
- Sanitize labels into SSH aliases; collisions within the source get suffixes.
  Returning `added` / `skipped` labels is the local result, not a login test.
- Save authorized keys under `termius_keys/key_<content-hash>`; repeated runs
  reuse matching contents. Never replace a key containing different data.
  Only keys for new, kept hosts are considered. Unreferenced keys are not copied.
- Before changing existing config files, retain private `*.backup-*` copies.
  Repeating the same export does not duplicate hosts/includes or create backups
  for a no-op. Existing records are not updated when Termius changes.
- POSIX output: new directories 700, keys/config/backups 600. Windows output:
  secure empty staged files using the current Windows user's ACL **before**
  writing credentials, with one hidden PowerShell helper. WSL chmod is not used
  as a substitute for Windows ACLs. Existing personal-key contents are untouched.
- An export lock avoids concurrent skill writers; remove a stale lock only after
  confirming no writer remains. A failure can leave partial additions; backups
  are retained, not automatically restored. Symlink targets are refused; use the
  explicit real destination instead.

The reverse mapping covers address, port, username and a host-linked key.
Passwords, known_hosts, groups, proxy/jump rules, certificates and unrelated
Termius-specific settings are not migrated. Unsupported private-key formats
such as PPK need separate conversion. Collision detection is conservative, not
full OpenSSH conditional evaluation: complex existing Include/Match rules need
agent assessment. Do not add repeated doctor/export/verification steps for a
simple reverse export.

## Saved JSON and portable writer

```bash
# Explicit sensitive export: keys, but no login passwords or passphrases.
# Store/transfer only with authorization and private file permissions.
scripts/termius.sh export --keys

# Existing authorized JSON: no Windows interop or Termius startup is needed.
scripts/termius.sh export-ssh <target-.ssh-dir> --from <private-export.json> --keys
# Equivalent pure-Python entrypoint:
python3 scripts/vault_to_ssh.py <target-.ssh-dir> --from <private-export.json> --keys
```

A normal redacted `export` suffices for metadata-only migration. JSON from
`export --secrets` is also accepted, but passwords are discarded; prefer
`export --keys` when only keys are required. Do not put exported JSON in Git.
The writer does not delete a user-supplied source file; handle its retention
according to the user's intent. File references in the generated config are
absolute: stage/copy files only if the agent also adapts their destination paths.

## macOS: theoretical; assess the actual machine

macOS has a Unix-style `.ssh`, so the POSIX generation/permission approach is
**theoretically reusable**, not a verified support claim. An agent must combine
this skill with the actual source/target environment:

- Confirm which machine owns Termius and which SSH home is intended. A Windows
  or WSL path does not become a Mac path merely by selecting `--platform macos`.
- With an already authorized export available on the Mac, the portable writer
  can be tried with that Mac's own explicit target and `--platform macos`.
  Assess local Python, OpenSSH, paths and permissions as needed; avoid a fixed
  sequence of unnecessary tests.
- Reading that Mac's **own Termius vault** needs different glue (Keychain,
  `~/Library/Application Support/Termius`, native module and app/runtime paths).
  The shipped live driver is Windows-specific. Use an existing export or adapt
  only after checking the installed app; do not pretend cmd.exe/Credential
  Manager works on macOS or that the native Mac path has been tested.
- `--platform macos` emits an explicit theoretical/unverified warning. If run
  on another OS it additionally warns that absolute paths need adaptation.

Do not connect to or copy onto a remote Mac implicitly; target-machine access
and credential transfer require the user's intended host and authorization.
