# agent-skills

[English](README.md) | [简体中文](README.zh-CN.md)

可复用、面向具体任务的 [Agent Skills](https://agentskills.io/specification) 集合。

## Skills

每个技能位于独立目录，以 `SKILL.md` 为入口，按需包含脚本和参考资料。
具体用法见对应技能页面。

| 技能 | 说明 |
|---|---|
| [termius-vault](termius-vault/README.zh-CN.md) | 在 Termius 与 OpenSSH 之间双向迁移 SSH 主机和关联密钥，导出保险库数据、检查认证关联。适用于配置迁移、备份与密钥绑定排查。 |

## 获取

```bash
git clone https://github.com/Binggo913/agent-skills.git
```

通过当前 agent 支持的方式安装所选技能目录。

## 许可证

MIT —— 见 [LICENSE](LICENSE)。
