# dsh

一台 Linux 电脑上跑的 DeepSeek Harness（DSH）全套：三个自研插件、桌面端、
Telegram 总控层、Skill 库服务与 Agent skill。DSH 官方版 `0.2.2-rc.1`。

## 目录

```
packages/                  DSH 插件（装进 web profile）
  dsh-control-panel/       总控台：记忆 / 代码 / 生活三张实时状态卡，点卡进对话
  dsh-plugin-library/      插件库：官方 / 非官方两层，可开关、删除后装插件
  dsh-skill-library/       Skill 库：各 Agent 的 skill 列表
apps/
  dsh-desktop/             Electron 桌面壳（自动起 DSH web 服务 + QQ 渐变毛玻璃界面）
services/
  dsh-bridge/              Telegram 总控层（桥 + 每周记忆自优化 + systemd 单元 + 备份/心跳脚本）
  skill-library/           本机 HTTP 服务（8899 端口，给上面两个库插件供数据）
skills/                    Agent skill（全局 / code / life / memory；同一份 skill
                           会装到多个 Agent 上，所以看着有重复）
docs/
  dsh-notes.md             备份、看门狗、迁移与排障手记
```

## 装插件

每个插件是一个标准 DSH 包（`package.json` 里有 `dsh` 字段、`lib/`、`cordis.patch.yml`，
根目录有官方风格的 `icon.svg`）。

```bash
dsh plugin --profile web add github:Aumn38/dsh#path:/packages/dsh-control-panel
dsh plugin --profile web add github:Aumn38/dsh#path:/packages/dsh-plugin-library
dsh plugin --profile web add github:Aumn38/dsh#path:/packages/dsh-skill-library
```

`#path:` 这种写法还没在真机上验证过，装不上就用兜底办法：先 clone，再本地装：

```bash
git clone https://github.com/Aumn38/dsh.git
dsh plugin --profile web add ./dsh/packages/dsh-control-panel
dsh plugin --profile web add ./dsh/packages/dsh-plugin-library
dsh plugin --profile web add ./dsh/packages/dsh-skill-library
```

装完重开 DSH 应用生效（插件没有热重载）。插件库里自带开关与删除：
开关只改 `package.json` 的 `bundles`，删除会把插件从配置里移除但保留
`/opt/localagent/dsh-plugins/` 下的源码，可重新启用。

## 跑起来

- **桌面端**：见 `apps/dsh-desktop/`（Electron 壳，自动起 `dsh web` 服务）。
- **Skill 库服务**：见 `services/skill-library/README.md`（8899 端口，插件库靠它读数据）。
- **Telegram 桥**：见 `services/dsh-bridge/README.md`（systemd 服务 + 每周自优化）。
- **备份与看门狗**：见 `docs/dsh-notes.md`。

## 凭证

本仓库**不含任何密钥**。桥与自优化脚本从 `/opt/localagent/config/agent.env`
（600 权限）读 `TELEGRAM_BOT_TOKEN` 与 `DEEPSEEK_API_KEY`；备份脚本也明确排除它。
部署时自己在目标机上建这个文件，不要提交、不要贴到聊天记录里。

## License

MIT — 见 [LICENSE](LICENSE)。
