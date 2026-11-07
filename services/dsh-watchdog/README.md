# dsh-watchdog（VPS 侧看门狗）

PC 上的 DSH 桥掉线时发 Telegram 通知，恢复了也报一声。跑在 VPS 上，每 5 分钟一次 cron。

## 文件

- `dsh-watchdog.sh` — 主脚本。读 `/var/backups/dsh/heartbeat.txt`（PC 每 2 分钟写的心跳），超过 420 秒没更新就判掉线；状态变化才发通知，状态不变不打扰。
- `dsh-prune.sh` — 每天清一次，删掉 `/var/backups/dsh/` 里 7 天以前的备份快照。

## 部署

```bash
# 放到 VPS
sudo cp dsh-watchdog.sh /usr/local/bin/dsh-watchdog.sh
sudo cp dsh-prune.sh /usr/local/bin/dsh-prune.sh
sudo chmod +x /usr/local/bin/dsh-watchdog.sh /usr/local/bin/dsh-prune.sh

# 机器人 token 只放 VPS，不进仓库
echo '<bot-token>' | sudo tee /etc/dsh-watchdog/bot_token
sudo chmod 600 /etc/dsh-watchdog/bot_token

# cron（root）
*/5 * * * * /usr/local/bin/dsh-watchdog.sh
0 4 * * * /usr/local/bin/dsh-prune.sh
```

通知发到 `CHAT_ID`（脚本里写死的 Telegram 用户 ID），token 只从 `/etc/dsh-watchdog/bot_token` 读，仓库里没有。
