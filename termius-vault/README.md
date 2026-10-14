# Termius Vault

[English](README.md) | [简体中文](README.zh-CN.md) | [All skills](../README.md)

Move SSH hosts and linked keys between Termius and OpenSSH `.ssh` directories,
export vault data, or inspect which credentials a host uses. This does not log
in to servers or reproduce every Termius/OpenSSH feature.

## Environment and support

- Live vault access is implemented for **Windows Termius controlled from WSL**:
  Python 3.8+, Windows interop, `cmd.exe`, and `wslpath`. It uses Termius's bundled
  runtime; a separate Windows Node install is not needed. YAML specs additionally
  need PyYAML.
- SSH-config parsing and reverse output from an existing JSON export are
  independent of the live vault bridge. Windows output uses Windows ACLs;
  WSL/Linux output uses POSIX permissions.
- **macOS is theoretical and unverified.** The agent must assess the actual
  machine, paths, source data, and permissions. The shipped live bridge is not a
  native Mac vault reader. See [Mac assessment](references/export-ssh.md#macos-theoretical-assess-the-actual-machine).

## Choose a direction

After registering this skill with your agent, ask for the intended migration or
inspection and specify the actual source/target machine. For direct CLI use,
run from this `termius-vault` directory; the examples are separate tasks, not a
sequence to execute in full:

```bash
# OpenSSH → Termius
scripts/termius.sh import "$HOME/.ssh"

# Termius → WSL SSH configuration; private keys are not saved by default
scripts/termius.sh export-ssh "$HOME/.ssh"

# Termius → Windows SSH configuration plus explicitly authorized private keys
scripts/termius.sh export-ssh "/mnt/c/Users/<WindowsUser>/.ssh" --platform windows --keys
```

Replace `<WindowsUser>` with the intended Windows account. WSL's `~/.ssh` is not
Windows or Mac home. Existing entries are not automatically updated/replaced.
Add `--restart` only with permission to close Termius and active SSH sessions;
raw credential exports also require explicit authorization.

## Details when needed

| Task | Reference |
|---|---|
| SSH-config sources, merge rules, filtering, parser limits | [Import](references/import.md) |
| Reverse output, key-file behavior, saved JSON, theoretical macOS path | [Reverse export](references/export-ssh.md) |
| Export/verify, push spec, batching, application lifecycle, recovery | [Commands](references/commands.md) |
| Upgrade or implementation diagnosis | [Vault format](references/termius-format.md) |

[SKILL.md](SKILL.md) is the agent entrypoint, not an additional human setup step.
Secrets stay out of tracked examples; reverse SSH files never receive exported
login passwords or stored key passphrases. Local insertion/config generation is
not evidence of native UI visibility, cloud sync, or successful SSH login.
