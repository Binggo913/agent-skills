# agent-skills

[English](README.md) | [简体中文](README.zh-CN.md)

A collection of reusable, task-focused [Agent Skills](https://agentskills.io/specification).

## Skills

Each skill is an independent directory with a `SKILL.md` entrypoint and any
supporting scripts or references it needs. Follow its page for detailed usage.

| Skill | Description |
|---|---|
| [termius-vault](termius-vault/README.md) | Bidirectional migration of SSH hosts and linked keys between Termius and OpenSSH; export vault data and inspect authentication bindings. Useful for configuration migration, backups, and key-binding troubleshooting. |

## Get

```bash
git clone https://github.com/Binggo913/agent-skills.git
```

Install the chosen skill directory using the method supported by your agent.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

## License

MIT — see [LICENSE](LICENSE).
