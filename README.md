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

## Install

Clone into a directory Pi scans, then `/reload` (or restart Pi):

```bash
# user-level, portable Agent Skills location
git clone https://github.com/Binggo913/agent-skills.git ~/.agents/skills/agent-skills

# or, if you use Pi's own skills dir
git clone https://github.com/Binggo913/agent-skills.git ~/.pi/agent/skills/agent-skills
```

Pi discovers directories containing `SKILL.md` recursively, so every skill in
this repository becomes available, e.g. `/skill:termius-vault`.

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
