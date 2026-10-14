# OpenSSH → Termius

This reference owns SSH source preparation and import limits. Shared flags and
application behavior are in [commands.md](commands.md).

Run from the skill directory. Windows Termius access is implemented through
WSL; pure parsing also works without Windows. For theoretical Mac use, assess
the actual machine as described in [export-ssh.md](export-ssh.md#macos-theoretical-assess-the-actual-machine).

## Merge sources before touching Termius

```bash
# Independent task: merge these sources in one import.
# Replace <WindowsUser>; --restart requires permission to close sessions.
scripts/termius.sh import "$HOME/.ssh" "/mnt/c/Users/<WindowsUser>/.ssh"
```

One invocation accepts multiple configs/directories, preparing one desired
spec and using one app lifecycle. Duplicate aliases use the first source.
Keys are shared by resolved file path; distinct keys with colliding basenames
receive distinct spec names. Existing Termius labels are skipped, not updated.
The result includes local verification. For a vault comparison without record
writes, add `--dry-run` when needed; it is not a mandatory preceding step.

## Preview source data without starting Termius

```bash
python3 scripts/sshconfig_to_spec.py "$HOME/.ssh" --only 'build-*'
```

This emits labels/addresses/users/ports and key-file references, not inline
private keys. It cannot tell whether an entry already exists in Termius.
It is useful for source-only inspection, not an additional required import step.

## Filters and paths

```bash
scripts/termius.sh import "$HOME/.ssh" --only 'build-*' --only 'deploy-*'
scripts/termius.sh import "$HOME/.ssh" --only 'prod-*' --exclude 'prod-legacy'
scripts/termius.sh import "/mnt/c/Users/<WindowsUser>/.ssh" --only 'build-*,deploy-*'
```

Filters are repeatable/comma-separated glob patterns; excludes win. Only kept
hosts contribute key references. Keys belonging only to skipped hosts are not
read or imported. A missing retained key fails preparation before app access.

Use WSL-visible `.ssh` directories or config files. `C:/...` and `D:\...` paths
in sources, IdentityFile and Include are mapped to `/mnt/<drive>/...`.
`~` in IdentityFile uses the source's inferred home directory. Quoted/absolute
Includes and simple source-relative Includes are handled; the parser still does
not reproduce all OpenSSH Include context rules.

## Parser boundary

The importer is a limited parser, not `ssh -G`. It extracts concrete aliases,
HostName, User, Port and the first IdentityFile, with simple Host patterns and
first-value-wins scalar options. Wildcard-only hosts cannot enumerate aliases.
Multiple identities, Match/exec conditions, ProxyJump/ProxyCommand, SSH-agent
credentials, token expansion, certificates and full OpenSSH Include semantics
are not faithfully migrated. Quoted/complex configs may need a hand-written
push spec. For complex configs, use source-only preview or a hand-written spec when needed.
A successful local insertion is not connection-equivalence validation.

For a plain migration fully covered by Termius's own SSH-config importer,
consider that built-in UI instead of vault scripting. Use this skill for
existing-vault access, scripted filtering, or merged/bulk additions.
