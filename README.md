# agent-skills

[English](README.md) | [简体中文](README.zh-CN.md)

A collection of reusable, task-focused [Agent Skills](https://agentskills.io/specification).
Each skill has its own purpose, requirements, scripts, and operating boundaries.
This is a skill library, not a single application or a shared runtime.

## Skill catalog

| Skill | Purpose |
|---|---|
| [termius-vault](termius-vault/README.md) | Move SSH hosts and linked keys between Termius and OpenSSH; inspect vault data and authentication bindings. |

Follow a skill's page for its supported environments, limitations, and usage.
Adding a skill does not make its dependencies requirements for the whole repo.

## Get and register a skill

```bash
git clone https://github.com/Binggo913/agent-skills.git "$HOME/agent-skills"
```

If you already have this checkout, reuse it. Then:

1. Choose a skill from the catalog and read its requirements.
2. Register **that skill directory** with your agent's supported installer or
   configured discovery directory. Its root must contain `SKILL.md`.
3. Select/invoke it using your agent's own mechanism, then give it the task.

A Git clone stores the files; it does not necessarily register them. Discovery
paths, nested-directory scanning, symlinks, invocation syntax, and supported
metadata vary by agent/version. Do not assume that registering the repository
root discovers every skill. Use the agent's current configuration/documentation
rather than treating one client's directory layout as a universal convention.

If the agent supports directory symlinks, an optional registration is:

```bash
# Replace both paths; the destination must not already exist.
ln -s "/path/to/agent-skills/<skill-name>" "/configured/agent/skills/<skill-name>"
```

Otherwise use its installer or copy the chosen skill directory as supported.
Do not overwrite an existing installation or force symlink support.

For a Git-based installation, update from the checkout when ready:

```bash
git -C "$HOME/agent-skills" pull --ff-only
```

Linked installations use the updated checkout; copied installations need the
changed skill copied/installed again. To uninstall, remove only the chosen
registration/link or installed copy; do not delete generated user data implicitly.

## Documentation map

| Location | Audience and purpose |
|---|---|
| Root `README*` | Choose skills and understand repository-level installation/structure. |
| Skill `README*`, when needed | Human onboarding, requirements, examples, and links. |
| `<skill>/SKILL.md` | Agent entrypoint: applicability, essential constraints, and task routing. |
| `<skill>/references/` | Mode-specific instructions and implementation notes, read only as needed. |
| `<skill>/scripts/` | Executable helpers; dependencies belong to that skill. |

Not every skill needs every optional directory or document. A skill is identified
by `SKILL.md`, not by being any arbitrary top-level directory.

Discovery/invocation policy belongs to each skill and its host agent. This
layout keeps detail out of the shared entrypoints; it does not promise identical
activation behavior or zero token overhead across clients. Installation or
invocation alone does not authorize sensitive operations.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for scope, documentation ownership,
examples, and proportionate validation. Keep collection-wide guidance here and
skill-specific procedures inside the relevant skill.

## License

MIT — see [LICENSE](LICENSE).
