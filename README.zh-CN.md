# agent-skills

[English](README.md) | [简体中文](README.zh-CN.md)

可复用、面向具体任务的 [Agent Skills](https://agentskills.io/specification) 集合。
每个技能独立说明用途、依赖、脚本和操作边界；本仓库是技能库，不是单个应用，
也不提供所有技能共用的运行时。

## 技能目录

| 技能 | 用途 |
|---|---|
| [termius-vault](termius-vault/README.zh-CN.md) | Termius ↔ OpenSSH 主机与关联密钥迁移，以及保险库数据和认证关联检查。 |

具体环境支持、限制与用法见各技能页面。增加一个技能，不意味着它的依赖成为
整个仓库的共同要求。

## 获取并注册技能

```bash
git clone https://github.com/Binggo913/agent-skills.git "$HOME/agent-skills"
```

已有当前检出时直接复用，然后：

1. 从目录选择技能，阅读它的环境要求。
2. 使用 agent 支持的安装器或已配置的发现目录，注册**具体技能目录**；
   该目录的根部应有 `SKILL.md`。
3. 按当前 agent 的方式选择/调用技能，再说明任务。

Git 克隆只是取得文件，不一定完成注册。搜索路径、嵌套目录扫描、符号链接、
调用语法和可识别的元数据取决于 agent 及版本。不要假定注册仓库根目录就能发现
全部技能，也不要把某一个客户端的目录布局当作通用规范；以当前配置和文档为准。

如果 agent 支持目录符号链接，可选的注册方式为：

```bash
# 替换两个路径；目标位置必须尚不存在。
ln -s "/path/to/agent-skills/<skill-name>" "/configured/agent/skills/<skill-name>"
```

否则使用它支持的安装器或复制具体技能目录，不覆盖已有安装，也不强行使用链接。

使用 Git 检出时，可在准备更新后执行：

```bash
git -C "$HOME/agent-skills" pull --ff-only
```

链接式安装随检出更新；复制式安装需要重新复制/安装变动的技能。卸载时只移除
所选技能的注册、链接或安装副本，不隐式删除技能生成的用户数据。

## 文档分工

| 位置 | 读者与职责 |
|---|---|
| 根目录 `README*` | 选择技能，了解仓库级安装方式与结构。 |
| 按需提供的技能 `README*` | 面向人的上手说明、依赖、示例与导航。 |
| `<skill>/SKILL.md` | agent 入口：适用范围、关键约束与任务分流。 |
| `<skill>/references/` | 具体模式的操作细节和实现说明，按需读取。 |
| `<skill>/scripts/` | 可执行辅助工具，依赖由所属技能说明。 |

不要求每个技能都创建全部可选目录或文档。应通过 `SKILL.md` 识别技能，
而不是把任意顶层目录都视为技能。

发现和调用策略属于具体技能及其宿主 agent。这种布局让共享入口保持精简，
但不承诺各客户端激活行为一致或“零 token 开销”。安装或调用技能本身也不等于
授权其执行敏感操作。

## 参与维护

范围、文档归属、示例与适度验证要求见 [CONTRIBUTING.zh-CN.md](CONTRIBUTING.zh-CN.md)。
仓库通用说明留在此处，技能专属操作放回对应技能目录。

## 许可证

MIT —— 见 [LICENSE](LICENSE)。
