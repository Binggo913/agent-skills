# agent-skills

A personal collection of [Agent Skills](https://agentskills.io/specification)
for the [Pi coding agent](https://github.com/badlogic/pi-mono) (also compatible
with Claude Code and Codex CLI style skill loaders).

Each top-level directory is one skill: a `SKILL.md` plus optional `scripts/`
and `references/`. Skills are generic tools — they contain no personal data,
credentials, or machine-specific paths.

## Skills

| Skill | Description |
|---|---|
| [`termius-vault`](termius-vault/) | Read, export, verify, or import hosts/keys/passwords for the Termius desktop SSH client on Windows. |

### Activation and token cost

Every skill here sets `disable-model-invocation: true`, so it is **never
selected automatically** and is **excluded from the system prompt**. That means
installed-but-unused skills add **no tokens** to your requests. Invoke one only
when you want it:

```text
/skill:termius-vault export
```

To let the model pick a skill up automatically from a task description instead,
remove `disable-model-invocation: true` from that skill's frontmatter (it will
then be advertised in the system prompt and cost a small number of tokens per
request).

## Install

The skill format is the cross-agent [Agent Skills](https://agentskills.io/specification)
standard, so the same repo works in Pi, Claude Code, Codex CLI, Amp, and Droid.
Install per agent:

| Agent | Install location | Invoke |
|---|---|---|
| **Pi** | `git clone <repo> ~/.pi/agent/skills/agent-skills` (recursive) | `/skill:termius-vault` |
| **Claude Code** | symlink each skill under `~/.claude/skills/` (one level deep only) | `/termius-vault` |
| **Codex CLI** | `git clone <repo> ~/.codex/skills/agent-skills` (recursive) | `$termius-vault` |
| **Amp** | `git clone <repo> ~/.config/amp/tools/agent-skills` | — |
| **Droid** | `git clone <repo> ~/.factory/skills/agent-skills` | — |

```bash
REPO=https://github.com/Binggo913/agent-skills.git

# Pi
git clone "$REPO" ~/.pi/agent/skills/agent-skills

# Codex CLI
git clone "$REPO" ~/.codex/skills/agent-skills

# Claude Code (scans only one level deep; symlink individual skills)
mkdir -p ~/.claude/skills
ln -sfn ~/.pi/agent/skills/agent-skills/termius-vault ~/.claude/skills/termius-vault
```

### Explicit-invocation only (no idle token cost)

Every skill here sets `disable-model-invocation: true`. This is honored by Pi,
Claude Code, and Codex CLI:

- **Pi** — the skill is excluded from the system prompt entirely.
- **Codex CLI** — the skill is not added to the model context; it stays
  available only when explicitly invoked as `$skill-name`.
- **Claude Code** — the model cannot invoke it via the Skill tool; only the
  user can run its slash command.

So an installed-but-unused skill adds **no tokens** to a request. Invoke it only
when you want it, then it loads its `SKILL.md` on demand.

To let a given agent select a skill automatically from a task description
instead, remove `disable-model-invocation: true` from that skill's frontmatter
(it will then be advertised to the model and cost a small number of tokens per
request).

### Compatibility

Skills here may declare a `compatibility` field. `termius-vault` needs a
**Windows host running the Termius desktop app, driven from WSL/Linux** — it
uses `cmd.exe`, `wslpath`, and Termius' bundled Electron runtime. Other skills
may have different requirements; check each `SKILL.md`.

## Layout

```text
agent-skills/
└── termius-vault/
    ├── SKILL.md
    ├── scripts/
    │   ├── termius.sh            # WSL/Linux driver
    │   ├── prepare_desired.py    # inline key files into a push spec
    │   └── win/
    │       ├── termius-ctl.js    # Windows-side controller (CDP + native crypto)
    │       └── cred-read.ps1     # read Termius/localKey from Credential Manager
    └── references/
        ├── termius-format.md
        └── examples/
```

## License

MIT — see [LICENSE](LICENSE).
