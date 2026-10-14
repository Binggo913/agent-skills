# agent-skills

[English](README.md) | [简体中文](README.zh-CN.md)

Cross-agent [Agent Skills](https://agentskills.io/specification) for
[Pi](https://github.com/badlogic/pi-mono), Claude Code, Codex CLI, Amp, and
Droid. Each top-level directory is a skill (`SKILL.md` plus optional `scripts/`
and `references/`). Skills are generic: no personal data, credentials, or
machine-specific paths.

## Skills

| Skill | What it does |
|---|---|
| [`termius-vault`](termius-vault/) | Bidirectional Termius ↔ OpenSSH host/key migration; inspect/export vaults and verify bindings. Windows/WSL live access; macOS theoretical, machine-dependent. |

## Install

Clone into your agent's configured skill directory. The examples below show
common layouts; discovery and nested-directory support vary by agent/version.
If your agent does not discover nested skills, link the individual skill folder.

```bash
REPO=https://github.com/Binggo913/agent-skills.git

git clone "$REPO" ~/.pi/agent/skills/agent-skills      # Pi
git clone "$REPO" ~/.codex/skills/agent-skills         # Codex CLI
git clone "$REPO" ~/.config/amp/tools/agent-skills     # Amp
git clone "$REPO" ~/.factory/skills/agent-skills       # Droid

mkdir -p ~/.claude/skills                              # Claude Code
ln -sfn ~/.pi/agent/skills/agent-skills/termius-vault ~/.claude/skills/termius-vault
```

Invoke explicitly: Pi `/skill:<name>`, Claude Code `/<name>`, Codex `$<name>`.

## Activation and context size

Skills retain `disable-model-invocation: true` for explicit invocation where the
agent supports it. Invocation and discovery policies differ by agent; this is
not a universal guarantee of zero token overhead. The entrypoint stays short:
command/schema details, import caveats, and implementation notes are separate
references, loaded only for the relevant task.

## Compatibility and workflow

`termius-vault` requires Windows Termius desktop, WSL interop, Python 3,
`cmd.exe`, and `wslpath`. It uses Termius's bundled Electron/Node runtime; YAML
specs additionally require PyYAML. SSH-config parsing is portable; macOS vault
access is theoretical and requires assessment on the actual machine; the shipped
live-vault bridge is Windows-specific.

Merge SSH sources into one `import`, or use `batch` for several vault operations.
Termius writes return local verification, avoiding an extra GUI cycle. Reverse
`export-ssh` requires an explicit destination, preserves existing aliases and
key contents, and writes private keys only with `--keys`; passwords stay out of
SSH files. Helpers hide
console windows; reads restore the original open/closed state and writes refresh
once at the end of Termius writes. Termius itself may still show a startup window; this is not
headless access. `--restart` requires permission to close active sessions;
`--keep-debug` is opt-in because CDP exposes vault access locally.

See [the skill](termius-vault/SKILL.md) and
[commands/lifecycle](termius-vault/references/commands.md), and
[reverse/macOS guidance](termius-vault/references/export-ssh.md).

## License

MIT — see [LICENSE](LICENSE).
