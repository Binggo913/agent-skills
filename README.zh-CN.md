# agent-skills

[English](README.md) | [简体中文](README.zh-CN.md)

跨 agent 的 [Agent Skills](https://agentskills.io/specification) 集合，适用于
[Pi](https://github.com/badlogic/pi-mono)、Claude Code、Codex CLI、Amp、Droid。
每个顶层目录是一个 skill（`SKILL.md` + 可选的 `scripts/`、`references/`）。
这些 skill 都是通用工具：不含个人信息、凭据或与具体机器绑定的路径。

## 技能

| 技能 | 作用 |
|---|---|
| [`termius-vault`](termius-vault/) | 读取、导出、校验，或在 Termius 桌面版 SSH 客户端中新增主机/密钥/密码；也可从 OpenSSH config（Windows 宿主机或 WSL `~/.ssh`）导入主机。 |

## 安装

将仓库克隆到 agent 配置的技能目录。以下是常见布局，发现规则和嵌套目录支持
取决于 agent 及版本；若无法发现嵌套技能，单独链接具体的 skill 目录。

```bash
REPO=https://github.com/Binggo913/agent-skills.git

git clone "$REPO" ~/.pi/agent/skills/agent-skills      # Pi
git clone "$REPO" ~/.codex/skills/agent-skills         # Codex CLI
git clone "$REPO" ~/.config/amp/tools/agent-skills     # Amp
git clone "$REPO" ~/.factory/skills/agent-skills       # Droid

mkdir -p ~/.claude/skills                              # Claude Code
ln -sfn ~/.pi/agent/skills/agent-skills/termius-vault ~/.claude/skills/termius-vault
```

显式调用：Pi 用 `/skill:<name>`，Claude Code 用 `/<name>`，Codex 用 `$<name>`。

## 激活方式与上下文开销

保留 `disable-model-invocation: true`，在支持此设置的 agent 中使用显式调用。
不同 agent 的发现和调用规则不同，不能笼统承诺“未使用时零 token”。
技能入口只保留决策所需的信息；命令/格式、导入限制与实现说明分开放入参考文件，
仅在对应任务需要时读取。

## 兼容性与操作流程

`termius-vault` 需要 Windows Termius 桌面版、WSL 互操作、Python 3、
`cmd.exe` 和 `wslpath`。使用 Termius 自带 Electron/Node 运行时；YAML 输入
额外需要 PyYAML。SSH config 解析可跨平台，macOS 保险库访问尚未实现。

多个 SSH 来源合并为一次 `import`；多个保险库操作用 `batch`。写入直接返回本地
关联校验，避免为校验再启动一次。辅助程序隐藏控制台窗口，读取恢复原先的开/关
状态，写入仅在流程最后刷新一次。Termius 首次启动仍可能显示窗口，不能承诺无界面。
`--restart` 需获准关闭现有会话；`--keep-debug` 必须显式选择，因为 CDP 允许本机
进程访问保险库。

详见[技能入口](termius-vault/SKILL.md)与
[命令和生命周期说明](termius-vault/references/commands.md)。

## 许可证

MIT —— 见 [LICENSE](LICENSE)。
