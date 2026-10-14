# agent-skills

Cross-agent [Agent Skills](https://agentskills.io/specification) for
[Pi](https://github.com/badlogic/pi-mono), Claude Code, Codex CLI, Amp, and
Droid. Each top-level directory is a skill (`SKILL.md` plus optional `scripts/`
and `references/`). Skills are generic: no personal data, credentials, or
machine-specific paths.

## Skills

| Skill | What it does |
|---|---|
| [`termius-vault`](termius-vault/) | Read, export, verify, or add hosts/keys/passwords in the Termius desktop SSH client; import hosts from an OpenSSH config (Windows host or WSL `~/.ssh`). |

## Install

Pi, Codex, Amp, and Droid scan recursively, so clone the whole repo. Claude Code
scans one level deep, so symlink individual skills.

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

## Activation

Every skill sets `disable-model-invocation: true`: it is user-invocable only and
is never added to the model context, so installed-but-unused skills cost **no
tokens**. Remove that line from a skill's frontmatter to allow automatic model
selection instead (a small token cost per request).

## Compatibility

`termius-vault` needs the Termius desktop app and is **implemented and tested on
Windows, driven from WSL/Linux** (Credential Manager, `cmd.exe`, `wslpath`). Its
SSH-config parsing is portable; macOS is plausible (Termius is Electron there)
but unimplemented and untested. Other skills may differ — see each `SKILL.md`.

## License

MIT — see [LICENSE](LICENSE).
