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

Pi、Codex、Amp、Droid 会递归扫描，克隆整个仓库即可；Claude Code 只扫描一层，需要逐个符号链接。

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

## 激活方式

每个 skill 都设置了 `disable-model-invocation: true`：仅用户可调用，且永远不会加入模型上下文，因此**已安装但未使用时零 token 开销**。若要允许模型自动选择，删除 frontmatter 中该行即可（会产生少量每请求 token）。

## 兼容性

`termius-vault` 依赖 Termius 桌面版，目前**在 Windows 上实现并测试通过，由 WSL/Linux 驱动**（凭据管理器、`cmd.exe`、`wslpath`）。其 SSH config 解析部分可跨平台；macOS 理论上可行（Termius 在 mac 上同为 Electron），但尚未实现与测试。其它技能可能不同 —— 见各自的 `SKILL.md`。

## 许可证

MIT —— 见 [LICENSE](LICENSE)。
