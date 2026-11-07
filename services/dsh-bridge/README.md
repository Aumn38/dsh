# dsh-bridge — Telegram 总控层

DSH 的 Telegram 入口：一个 Python 服务把 Telegram Bot 连到官方 DSH，
按意图把消息分发给记忆 / 代码 / 生活三个 Agent（+ general 兜底）。

## 文件

- `dsh_bridge.py` — 总控层主程序。长轮询 Telegram `getUpdates`，意图分流
  （规则优先：`/coder` `/life` `/memory`；自由文本用 DeepSeek Flash 分类一次），
  经 DSH Python SDK（newline JSON-RPC，`sdk-jsonrpc-server` 插件）驱动
  `dsh --profile sdk` 的持久会话，再 `sendMessage` 回过去。
  每个 Agent 有自己的会话与工作目录；子代理上限：每任务 3 个、最多 2 层。
  注意：不要用 `web` 配置档跑桥（`web` 是浏览器 UI 的 server）。
- `dsh_memory_optimize.py` — 记忆 Agent 每周自优化：复查会话日志与记忆，
  提炼 1–3 个可复用方法写成 skill，装到代码 / 生活 Agent 上，
  每条记一行审计到 `memory/skill-audit.log`（不走 `/approve` 门禁，留审计记录）。
- `systemd/` — systemd 单元文件：
  - `localagent-dsh-bridge.service` — 桥（开机自启，失败自动重启）。
  - `localagent-dsh-memory-optimize.service` + `.timer` — 每周日 03:00 自优化。
  - `dsh-backup.service` + `.timer` — 每日 03:00 把 DSH 状态备份到 VPS。
  - `dsh-heartbeat.service` + `.timer` — 每 2 分钟向 VPS 推一次心跳。
- `scripts/` — 备份与心跳脚本（单元文件调用的）：
  - `dsh-backup.sh` — rsync `--link-dest` 快照到 VPS，保留 7 天。
    只拷白名单里的源；`agent.env`（凭证）与虚拟环境绝不进备份。
  - `dsh-heartbeat.sh` — 写状态到 VPS 的心跳文件。

## 凭证（重要）

桥与自优化脚本**不含任何密钥**。它们从 `/opt/localagent/config/agent.env`
（600 权限，`localagent` 所有）读：

```
TELEGRAM_BOT_TOKEN=...
DEEPSEEK_API_KEY=...
```

没有这个文件（或缺 key）服务会直接报错退出。**绝不要把 `agent.env`
或任何密钥放进仓库。** 备份脚本也明确排除它。

## 运行

Python 虚拟环境在 `/opt/localagent/dsh-venv`，DSH 经 Node 24 的 wrapper
`/opt/localagent/bin/dsh-node24` 跑（系统 Node 是 v22，跑不了官方 DSH）。

```bash
# 桥（systemd）
sudo systemctl enable --now localagent-dsh-bridge.service
# 每周自优化（timer）
sudo systemctl enable --now localagent-dsh-memory-optimize.timer
# 手动跑一次自优化
/opt/localagent/dsh-venv/bin/python /opt/localagent/dsh-bridge/dsh_memory_optimize.py
```

网络出口受 nftables 白名单管制（只放行 `localagent` 用户的 Telegram /
DeepSeek / 智谱等地址），换 API 域名或 IP 要同步改防火墙与 `/etc/hosts`。
