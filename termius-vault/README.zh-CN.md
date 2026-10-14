# Termius Vault

[English](README.md) | [简体中文](README.zh-CN.md) | [全部技能](../README.zh-CN.md)

在 Termius 与 OpenSSH `.ssh` 目录之间迁移主机和关联密钥，导出保险库数据，
或检查主机使用的认证信息。此技能不登录服务器，也不完整复刻双方的全部功能。

## 环境与支持边界

- 实时保险库访问已针对 **Windows Termius + WSL 控制**实现：需要 Python 3.8+、
  Windows 互操作、`cmd.exe` 和 `wslpath`。使用 Termius 自带运行时，不需要单独
  安装 Windows Node；YAML 清单额外需要 PyYAML。
- SSH config 解析、从已有 JSON 反向生成文件，不依赖实时保险库桥接。
  Windows 输出采用 Windows ACL，WSL/Linux 输出采用 POSIX 权限。
- **macOS 为理论支持，未经验证。** agent 需结合当前机器、路径、来源数据与权限
  判断；现有实时桥接不是原生 Mac 保险库读取器。
  见 [Mac 环境判断](references/export-ssh.md#macos-theoretical-assess-the-actual-machine)。

## 选择迁移方向

向 agent 注册此技能后，说明要迁移或检查什么，并明确实际来源/目标机器。
直接使用 CLI 时，从当前 `termius-vault` 目录运行。下面是独立任务示例，
不是需要整套依次执行的步骤：

```bash
# OpenSSH → Termius
scripts/termius.sh import "$HOME/.ssh"

# Termius → WSL SSH 配置；默认不保存私钥
scripts/termius.sh export-ssh "$HOME/.ssh"

# Termius → Windows SSH 配置，并显式允许保存私钥
scripts/termius.sh export-ssh "/mnt/c/Users/<WindowsUser>/.ssh" --platform windows --keys
```

将 `<WindowsUser>` 替换为预期的 Windows 账号。WSL 的 `~/.ssh` 不是 Windows 或
Mac 的用户目录。已有项不会自动更新或替换。只有获准关闭 Termius 及其 SSH 会话后
才能加 `--restart`；原始凭据导出同样需要明确授权。

## 按需了解细节

| 任务 | 参考资料 |
|---|---|
| SSH config 来源、合并、过滤与解析限制 | [导入](references/import.md) |
| 反向输出、密钥文件、已有 JSON、理论 macOS 路径 | [反向导出](references/export-ssh.md) |
| 导出/关联检查、push 格式、批处理、应用生命周期、恢复 | [命令](references/commands.md) |
| 升级或实现排查 | [保险库格式](references/termius-format.md) |

[SKILL.md](SKILL.md) 是 agent 入口，不是人上手时必须额外执行的一步。
不把秘密放入受跟踪的示例；反向 SSH 文件不保存导出数据中的登录密码或密钥口令。
本地插入/配置生成不代表原生界面可见、云同步完成或实际 SSH 登录成功。
