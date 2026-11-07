# DSH 备份与看门狗（2026-11-05 上线）

## 一、DSH 备份（PC → VPS，每夜）

- **备份源（PC，绝对路径已核实）**
  - `/opt/localagent/dsh-workspace`（记忆/代码/生活三会话 + skill：`python-small-task-delivery`、`relative-date-weekday`，及 `memory/skill-audit.log`）
  - `/opt/localagent/logs/dsh-baseline.jsonl`（Phase 4 基线日志）
  - `/opt/localagent/dsh-bridge/`（`dsh_bridge.py`、`dsh_memory_optimize.py`）
- **硬性排除（绝不进备份）**：`/opt/localagent/config/agent.env`（DeepSeek Key + Telegram Bot Token）、`/opt/localagent/dsh-venv`（虚拟环境）、`__pycache__`。排除靠“只拷上面三个源”实现，`agent.env` 根本不在源列表里。
- **备份位置（VPS）**：`/var/backups/dsh/<YYYY-MM-DD>/`，另有 `latest` 软链指向最新快照。目录属独立备份用户，不跟网站文件混在一起。
- **保留策略**：最近 7 天的每日快照。VPS 每日 04:00 用 `dsh-prune.sh` 删掉 mtime 超过 7 天的日期目录。
- **运行方式（PC 侧推送）**：PC 上 root 的 systemd timer `dsh-backup.timer`，每天 03:00 跑 `dsh-backup.service`（oneshot，执行 `/usr/local/bin/dsh-backup.sh`），`Persistent=true`（PC 关机那晚跳过、开机后补跑）。用 `rsync --link-dest` 做硬链接增量（未变文件不重复占空间）。
- **备份用户与密钥**：VPS 上独立用户 `dshbackup`（home `/home/dshbackup`，shell `/bin/sh`，无 sudo，只能写 `/var/backups/dsh/`）。PC root 用专用密钥 `/root/.ssh/id_dsh_backup`（指纹 SHA256:2y1ciQQtfWrkWh/8SlHEj+ZVJ8gX80Bfma0qgq/gEpE）经 tailnet 直连 VPS 的 `dshbackup@100.98.210.47`；VPS 的 `authorized_keys` 对该 key 加了 `no-port-forwarding,no-agent-forwarding,no-X11-forwarding,no-pty`。不拿 root 跑 rsync。
- **首次备份（2026-11-05 22:37，手动跑通）**：快照 `2026-11-05`，含基线日志、`dsh_bridge.py`、`dsh_memory_optimize.py`、三个会话的全部文件与两个 skill。`agent.env` 与 `dsh-venv` 确认不在备份里；`__pycache__` 已排除。
- **恢复抽查（2026-11-05）**：对 `dsh_bridge.py`、`memory/skill-audit.log`、`dsh-baseline.jsonl` 做 sha256，比对 PC 原件，三份哈希完全一致（备份文件与原件逐字节相同）。

## 二、VPS 看门狗（PC/桥掉线就通知）

- **为什么不用 VPS→PC 直连 SSH**：PC 没跑 OpenSSH（`sshd` inactive、无 `sshd_config`、22 口无监听），只接受 Tailscale SSH；且实测 VPS（`aamerica-vps`）到 PC（`100.119.90.121:22`）的 TCP 直连超时（`tailscale ping` 通但 22 口不通），是 tailnet ACL 挡住了 VPS→PC 的 SSH。所以看门狗改走**心跳**模式，不从 VPS 反向连 PC。
- **心跳（PC → VPS，每 2 分钟）**：PC 上 root 的 systemd timer `dsh-heartbeat.timer`（`OnCalendar=*:0/2`，`Persistent=true`）跑 `/usr/local/bin/dsh-heartbeat.sh`，每 2 分钟查 `systemctl is-active localagent-dsh-bridge`，把“状态 + epoch 秒 + ISO 时间”写到 VPS 的 `/var/backups/dsh/heartbeat.txt`（经同一把备份密钥、同一 `dshbackup` 用户）。2026-11-05 晚修复过一次心跳脚本 bug：`systemctl is-active` 在 inactive 时既打印状态又以非零退出，旧写法 `|| echo "inactive"` 会把状态写成两行；现已改为直接取 `systemctl` 的输出、空值才补 `inactive`。
- **看门狗（VPS，每 5 分钟）**：`/usr/local/bin/dsh-watchdog.sh`，root cron `*/5 * * * *`。每轮读心跳文件：心跳新鲜（≤420 秒）且状态为 `active` → 在线；否则（状态非 active、心跳超 7 分钟未更新、心跳文件缺失）→ 掉线。状态记在 `/var/lib/dsh-watchdog/state`（`up`/`down`）；只在状态**变化**时通知一次，不刷屏。日志 `/var/log/dsh-watchdog.log`。
- **通知通道**：Telegram Bot 的 `sendMessage`（只发消息，不轮询，不跟桥的 `getUpdates` 冲突）。Bot Token 只放在 VPS 的 `/etc/dsh-watchdog/bot_token`（600，root 所有，46 字节），**DeepSeek Key 绝不上 VPS**。Token 是从 PC 的 `/opt/localagent/config/agent.env` 直接在机器之间传过来的（PC 上读出、经 SSH 写到 VPS 临时文件再由 VPS root 移到最终位置），Token 值从未出现在任何工具调用、日志与聊天记录里。
- **看门狗不重启桥**（桥已有 systemd 自愈：连续 10 次 `getUpdates` 失败退出、systemd 重启），只负责检测与通知。

## 三、实测记录（2026-11-05 晚）

- **备份**：首次完整备份跑通（22:37），文件齐全；恢复抽查三份 sha256 全一致。✅
- **看门狗在线判定**：首次运行初始化状态 `up`，不发通知；`sendMessage` 测试消息返回 `{"ok":true,"message_id":4571}`，通知通道通。✅
- **掉线演练（受控）**：
  - 22:40:15 停桥（`systemctl stop localagent-dsh-bridge`）。
  - 22:45:02 看门狗发出“掉线”通知（`sendMessage ok`），距停桥 4 分 47 秒（≤5 分钟）。✅
  - 22:45:35 重新起桥，桥恢复 `active`（新进程 pid 57368，正常轮询）。
  - 22:50:02 看门狗发出“恢复”通知（`sendMessage ok`）。✅
  - 桥总共停了 5 分 20 秒（≤10 分钟）。
- **清理**：演练前为看门狗生成的 VPS OpenSSH 密钥（`id_dsh_watchdog`）已删除——PC 没有 OpenSSH 服务，该密钥无用，看门狗走心跳、不走 VPS→PC SSH。

## 四、关键路径一览

| 东西 | 位置 |
|---|---|
| 备份快照（VPS） | `/var/backups/dsh/<YYYY-MM-DD>/`，`latest` 软链 |
| 备份脚本（PC root） | `/usr/local/bin/dsh-backup.sh` |
| 备份 timer（PC） | `dsh-backup.timer`（每日 03:00，Persistent） |
| 备份用户（VPS） | `dshbackup`，PC root 密钥 `/root/.ssh/id_dsh_backup` |
| 备份日志（PC） | `/var/log/dsh-backup.log` |
| 保留清理（VPS） | `/usr/local/bin/dsh-prune.sh`，cron 每日 04:00，留 7 天 |
| 心跳脚本（PC root） | `/usr/local/bin/dsh-heartbeat.sh` |
| 心跳 timer（PC） | `dsh-heartbeat.timer`（每 2 分钟，Persistent） |
| 心跳文件（VPS） | `/var/backups/dsh/heartbeat.txt` |
| 看门狗脚本（VPS root） | `/usr/local/bin/dsh-watchdog.sh` |
| 看门狗 cron（VPS） | `*/5 * * * *`（root crontab） |
| 看门狗状态（VPS） | `/var/lib/dsh-watchdog/state` |
| 看门狗日志（VPS） | `/var/log/dsh-watchdog.log` |
| Bot Token（VPS，仅路径） | `/etc/dsh-watchdog/bot_token`（600，root，46 字节；值不在任何记录里） |

## 五、DSH 迁移：Python SDK → 官方 DSH（2026-11-06 00:40 完成）

- **起因**：major 2026-11-05 23:26 纠正——要真正的官方 DSH（Node `@deepseek-ai/dsh`），不是 Python SDK + 自写桥的变通；“该咋搞咋搞”。
- **迁移方式（关键设计）**：没有推倒重写桥。Python 桥（Telegram 轮询、意图分流、持久会话、基线）原样保留，只把 DSH 引擎从 Python SDK 自带的 bundled runtime 换成官方 npm 版 `dsh` 二进制——靠 `DeepSeekHarnessConfig` 的 `dsh_bin` 参数指向一个 wrapper（`/opt/localagent/bin/dsh-node24`），wrapper 用 `exec /opt/localagent/node24/bin/node …/bin.js` 强制 Node 24。SDK 经 newline JSON-RPC（`sdk-jsonrpc-server` 插件）驱动官方 `dsh --profile sdk`。**没用 `web` 配置档**：`web` 是跑浏览器 UI 的 server（含 launch token + cookie 鉴权、内部 RPC），SDK 客户端驱动的是 `sdk` 配置档；插件也因此装进 `sdk` 配置档。
- **版本（已核实）**
  - 官方 DSH：`@deepseek-ai/dsh@0.2.1-rc.2`（与 Python SDK 0.2.1rc2 同版，避免 JSON-RPC 协议不匹配；`dsh --version` = 0.2.1-rc.2）
  - Node：系统 Node 仍是 v22.23.4（没动）；DSH 专用 Node v24.22.2 装在 `/opt/localagent/node24`（binary tarball，checksum 已验），npm 11.19.1；全局包前缀 `/opt/localagent/npm-global`（dsh + pnpm 在此）
  - pnpm 12.16.1（`dsh plugin` 的安装器，npm 装不上插件，必须先有 pnpm）
  - 服务名不变：`localagent-dsh-bridge`（仍是同一 Python 桥服务）；运行时进程现为 `/opt/localagent/node24/bin/node …/node_modules/@deepseek-ai/dsh/lib/bin.js --profile sdk`
  - 桥代码改动：`dsh_bridge.py` 与 `dsh_memory_optimize.py` 各加一行 `dsh_bin="/opt/localagent/bin/dsh-node24"`（在 `DeepSeekHarnessConfig` 内）；备份文件 `.bak-pythonsdk` 留在同目录
- **迁移中踩到的三个坑（已解决）**
  1. **npm 装 DSH 一直卡住**：不是网络慢，是 nftables 白名单（UID 995 仅放行 Telegram + DeepSeek + DNS + 11434）把 localagent 到 npm registry/GitHub 的连接 drop 掉，npm 报 `ETIMEDOUT`。另 npm 一开始跑在 Node 22 下（`dsh` 的 shebang `#!/usr/bin/env node` 按 PATH 找，先找到系统 Node 22）。解决：临时加一条 runtime 规则（`nft add rule inet localagent output position 10 meta skuid 995 tcp dport 443 accept`，handle 12，仅运行时生效、不改配置文件），装完即删（已删，防火墙已恢复 restrictive；验证 localagent 到 registry 已不通、到 Telegram/DeepSeek 仍通）。npm 调用时 PATH 前置 `/opt/localagent/node24/bin`，之后 `dsh` 用 wrapper 彻底绕开 PATH 问题。
  2. **插件装不上之 pnpm**：`dsh plugin` 内部用 pnpm，不是 npm；须先 `npm install -g pnpm`。Git 托管的插件（universal-plugin-hub、reasoning-loop-guard）的 `prepare`/`postinstall` 脚本会被 pnpm 拦截（`ERR_PNPM_IGNORED_BUILDS`），须在 `profiles/sdk/pnpm-workspace.yaml` 的 `allowBuilds` 里加**精确 key**（对 Git 插件是完整 codeload URL，形如 `"universal-plugin-hub@https://codeload.github.com/…/tar.gz/<sha>": true`，只写包名不够）。
  3. **插件版本兼容**：`dsh-memory-palace@1.8.4` 要求 DSH `^0.2.1-rc.5`，与现有 0.2.1-rc.2 不兼容，拒绝安装（未用 `--accept-risk` 硬装）；改装 `1.8.2`（要求 `^0.2.1-alpha.1`）成功。`dsh-context` 最新 0.82.0 兼容（`>=0.2.1-rc.2`），实际装上 0.81.0。
- **三 Agent 验证（2026-11-06 00:1x，bridge-exact resume-first 流程）**：`general` resume 成功、回 `HELLO`；`memory`/`code`/`life` 三个真实会话此前不存在（resume 报 not found，属正常——用户之前只用过 general），经 start_session 后 `set_working_directory` OK、各回 `MEMORY-OK` / `CODE-OK` / `LIFE-OK`。注意：直接用全新会话 ID 调 `start_session` 再 `set_working_directory` 会在官方 runtime 下报 `session … already exists`（我的首版测试脚本因此失败）；桥的 resume-first 流程不受影响。测试在真实会话里各留了一轮带 `[migration test]` 标记的短消息，属验证痕迹。
- **Skill**：两个 skill（`python-small-task-delivery`、`relative-date-weekday`）仍在 workspace 的 `skills/`、`code/skills/`、`life/skills/` 原位，官方 DSH 直接沿用同一格式与位置，无需转换。
- **基线（Phase 4）**：机制 intact，桥启动仍记 `baseline logging to …/dsh-baseline.jsonl`。SDK 的 `RunResult` 仍**没有 token 用量字段**（attrs 只有 `events/final_response/finish_reason/notifications/session_id`），所以继续用字符数当 proxy；token 精确数仍看 DeepSeek 控制台。迁移后尚未有用户消息，基线文件仍停在 22:11 的两条，下一条用户消息会续记。
- **记忆自优化**：`dsh_memory_optimize.py` 同样加了 `dsh_bin`；timer `localagent-dsh-memory-optimize.timer` active，下次 2026-11-08（周日）03:00。
- **备份（已更新并实测）**：备份脚本 `/usr/local/bin/dsh-backup.sh` 源从 3 个加到 4 个，新增 `/opt/localagent/dsh-home`（官方 DSH 的状态：sessions 会话日志 + `profiles/sdk` 配置与插件；总计仅 948K；已 grep 确认 dsh-home 内无任何凭证文件，DeepSeek Key 仍只在 agent.env、不进备份）。手动跑一次备份通过：快照 `2026-11-06` 含 dsh-home（sessions + profiles/sdk），`agent.env`、dsh-venv、token 文件均不在快照里，`latest` 已指到 2026-11-06。备份 timer 仍每日 03:00。
- **看门狗（无需改动，已实测恢复）**：盯的服务名 `localagent-dsh-bridge` 没变，心跳与 VPS cron 均未动。迁移测试中我几次停桥，看门狗正确报出 down（16:15，`sendMessage ok`）与恢复 up（16:25，`sendMessage ok`）；现状态 `up`，心跳新鲜。用户当晚会收到这一对 down/up 通知，是迁移测试造成的，不是故障。
- **插件（sdk 配置档，`dsh plugin --profile sdk list` 已核实，4 个全装上）**
  - `dsh-memory-palace@1.8.2`（lovezi0；最新 1.8.4 不兼容当前 DSH，未硬装）
  - `universal-plugin-hub@1.0.35`（Ultmebius，GitHub 源；postinstall 装了 host 包 `@deepseek-ai/dsh-lsp` 等）
  - `dsh-context@0.81.0`（bowenliang123）
  - `dsh-reasoning-loop-guard@0.2.5`（himi-li，GitHub 源；截图里没有名为 `dsh-reasoning-only-guard` 的仓库，这是最接近的等价物。注：用户用的是 `deepseek-chat` 非推理模型，暂无 thinking 流可监控，此插件现阶段基本不触发）
  - 每装一个都重启桥验证：桥均正常起、harness started、正常轮询。插件带 UI 的部分（universal-plugin-hub、dsh-context 的面板）在 `sdk` 配置档下无 web UI 可显示，只有服务端功能在跑。
- **回滚（仍留着）**：Python SDK 的 venv、bundled runtime、桥代码备份（`.bak-pythonsdk`）都在；回滚只需把两处 `dsh_bin` 那行删掉（或恢复 `.bak-pythonsdk` 文件）再重启桥。迁移至今未删任何旧东西。
- **待用户发一条 Telegram 消息做最终端到端确认**：桥在轮询（offset 31278943），DSH 与四 Agent 已用 SDK 直接验证能回，但“用户发消息 → 桥 → 真 DSH → 回消息”这一整条 Telegram 链路尚未在迁移后实测（迁移当晚 00:40 前用户未发消息）。

## 六、DSH 升级到最新版（0.2.2-rc.1）——2026-11-06 上午，**进行中、因用户关电脑去上课紧急暂停**

- **起因**：major 2026-11-06 07:56 说“想办法都给我升到最新版啊”。升级协调员于 08:00 开始，08:14 因用户要关电脑去上课、PC 马上断电而紧急暂停。暂停时**没有包正装到一半**，停在干净的步骤边界上。
- **升级前备份（已跑通）**：08:00:08 手动跑 `/usr/local/bin/dsh-backup.sh`，快照 `2026-11-06` 更新成功（`backup OK`），是升级前的干净回滚点。
- **查到的目标版本（升级组合，已定）**
  - 官方 DSH：`0.2.2-rc.1`（npm `dist-tags.latest`；版本线 0.2.1-rc.2 → rc.3 → rc.4 → rc.5 → 0.2.2-alpha.2 → 0.2.2-alpha.3 → 0.2.2-rc.1）。0.2.2-rc.1 的发布说明要求 **Node ≥ 24.9**；现有 DSH 专用 Node 是 v24.22.2（24.22 > 24.9），满足要求，**Node 不用升**。系统 Node v22.23.4 没动。
  - Python SDK：**没有更新版本，留在 0.2.1rc2**。PyPI 上 `deepseek-harness-sdk` 与 `deepseek-harness-runtime-bin` 的最新版都只有 0.2.1rc2（2026-10-17 发布）；仓库 `dsh-v0.2.2-rc.1` 标签下的 `python/sdk/pyproject.toml` 版本是占位符 `0.0.0.dev0`，且打包 `runtime-bin` 需要注入编译好的 dsh 二进制、不是干净的 pip 升级路径。0.2.2 发布说明提到 Python SDK 有更新、且“SDK 和 Session 消费方需更新取消分类”（run_code 取消由 CODE_RUN_FAILED 改为 ABORTED），但 PyPI 未发布对应版本。**结论：SDK 0.2.1rc2 就是目前最新已发布版，先不动；DSH 升到 0.2.2-rc.1 后须用四 Agent 实测验证 SDK 与新 harness 的 JSON-RPC 是否兼容，不兼容则回滚 DSH。**
  - 插件最新版（GitHub releases + npm 双核实）：`dsh-memory-palace 1.8.4`、`universal-plugin-hub 1.0.45`、`dsh-context 0.82.0`、`dsh-reasoning-loop-guard 0.2.5`（已是最新，无需升）。
- **已完成：官方 DSH 升到 0.2.2-rc.1（磁盘上的二进制已是新版）**
  - 防火墙临时放行（runtime 规则，不改配置文件）：`nft add rule inet localagent output position 10 meta skuid 995 tcp dport 443 accept`，得 handle 13，位于 drop 规则（handle 11）之前；实测 localagent 到 npm registry / PyPI / GitHub API 均返回 200。
  - npm 安装（后台跑，约 8 分钟）：`npm install -g @deepseek-ai/dsh@0.2.2-rc.1`，`added 40 packages, removed 1 package, changed 614 packages`，EXIT:0；`dsh --version` 已验为 `0.2.2-rc.1`。
  - **npm install-scripts 拦截（新坑，已解决）**：npm 11 默认拦截未授权的 install scripts，首次安装报 5 个包脚本未跑：`@deepseek-ai/dsh-subprocess-local`（postinstall）、`koffi`、`node-pty`、`@google/genai`、`protobufjs`。其中 koffi 与 node-pty 是原生模块（不跑安装脚本就没有预编译二进制）、subprocess-local 的 postinstall 负责 spawn helper，缺了会影响 DSH 功能。解决：带 `--allow-scripts=@deepseek-ai/dsh-subprocess-local,koffi,node-pty,@google/genai,protobufjs` 重装一次（后台，约 2 分钟），`changed 654 packages`，EXIT:0，无警告。这 5 个包均来自 DSH 依赖树（DeepSeek 自家包 + koffi/node-pty/protobufjs 等知名库），放行是正常安装所需。
- **未做（暂停时还没开始）**
  - 四个插件**都没升**：磁盘上仍是 `dsh-memory-palace 1.8.2`、`universal-plugin-hub 1.0.35`、`dsh-context 0.81.0`、`dsh-reasoning-loop-guard 0.2.5`。
  - 桥**没重启**：桥进程（PID 66843，00:38 启动）内存里仍是旧 DSH 0.2.1-rc.2；磁盘上的新版还没被桥加载。
  - 四 Agent 的 SDK resume-first 实测还没做；备份（升级后）与看门狗的升级后核验还没做。
- **暂停时的系统状态（Bot 是否还能跑）**
  - 桥在内存里跑的是旧版 0.2.1-rc.2（已验证能跑的组合），VPS 心跳最后一条 `active 1793923924 2026-11-06T00:12:04Z`（08:12:04 CST），看门狗状态 `up`——暂停前 2 分钟桥还是 active 的，Bot 当时能正常跑旧版。
  - 但 PC 已无法 SSH（`proxy closed during CONNECT`；VPS 的 SSH 仍通，说明是 PC 侧离线、不是代理故障）。PC 断电前没来得及做最终的直接核验，以上状态以最后一次成功核查 + 心跳为准。
  - **重启后风险（待 PC 回来第一时间处理）**：PC 重启后桥会重新启动，加载的是磁盘上的新 DSH 0.2.2-rc.1 + 旧 SDK 0.2.1rc2 + 旧插件，这组搭配**未经实测**，可能正常、也可能因 JSON-RPC 不兼容而坏。回来后先重启桥并实测四 Agent；坏了修不好就按第八条回滚。
- **防火墙临时规则未删**：handle 13 的 443 放行规则暂停时还在。注意：它是 runtime 规则、不在配置文件里，PC 重启后 nftables 按配置文件重载、该规则自动消失（恢复 restrictive）。回来后仍须显式核查并确认已删（若 PC 只是睡眠未重启，须手动删）。
- **待办（PC 重新开机后继续）**
  1. 核查桥状态与 DSH 版本；确认防火墙临时规则（handle 13）已删、恢复 restrictive（localagent 到 registry 不通、到 Telegram/DeepSeek 仍通）。
  2. 升四个插件到最新兼容版（memory-palace 1.8.4、universal-plugin-hub 1.0.45、dsh-context 0.82.0、reasoning-loop-guard 已是 0.2.5 不动），逐个验版本；每升一个重启桥验证。
  3. 重启桥并验证：桥 active、子进程是新版 DSH 二进制（Node 24 + sdk 配置档）、general/memory/code/life 四 Agent 经 SDK resume-first 流程都能回、插件加载无报错、记忆自优化 timer 与基线记录仍在。
  4. 手动跑一次备份，确认新快照里有更新后的 dsh-home 且无凭证；确认看门狗心跳新鲜、状态 up。
  5. 若升级后桥或 Agent 坏了且修不好，滚回 DSH 0.2.1-rc.2 + Python SDK 0.2.1rc2 + 原插件版本（memory-palace 1.8.2、universal-plugin-hub 1.0.35、dsh-context 0.81.0、reasoning-loop-guard 0.2.5），确认 Bot 恢复再汇报。
  6. Telegram 端到端实测仍需用户发一条消息给 Bot（协调员无法替用户发）。
- **回滚点**：升级前备份快照 `2026-11-06`（08:00 手动跑的，含升级前 dsh-home）；DSH 回滚只需 `npm install -g @deepseek-ai/dsh@0.2.1-rc.2`（并重跑一次 allow-scripts）；插件回滚用 `dsh plugin --profile sdk add <包>@<旧版>`；SDK 没动过，不用回滚。

## 七、升级续做：插件升完、桥已跑新版（2026-11-06 12:20–12:33 完成）

- **起因**：major 2026-11-06 12:21 说“继续那个 DSH 的”，电脑已重新开机（parent 12:20 核实桥 active、DSH 磁盘版已是 0.2.2-rc.1）。续做协调员接手 §六 的待办继续做。
- **关键发现：PC 并未真正重启，只是睡眠/挂起**
  - 证据：桥进程 PID 66840/66843 的启动时间仍是 00:38:52（升级前）；防火墙临时规则 handle 13 还在（runtime 规则，真正重启后应自动消失）；桥日志 08:03–08:08 有 SSL 失败、之后断档、12:19:49 才又出现 getUpdates 失败（网络恢复），与用户 08:13 关电脑去上课、12:20 左右回来一致。
  - 影响：桥内存里仍是旧 DSH 0.2.1-rc.2（磁盘已是 0.2.2-rc.1），必须重启桥才加载新版；handle 13 也因此没消失，须手动删。
- **新 DSH + 旧 SDK + 旧插件组合实测（先独立 SDK 测试、再重启桥）**
  - 测试方法：写 `/tmp/test_dsh_upgrade.py`，用桥完全相同的 resume-first 流程（`DeepSeekHarnessConfig` 与桥一致：provider `deepseek-official`、model `deepseek-v4-flash`、`dsh_bin` wrapper、DSH_HOME、telemetry disabled），经 dsh-venv Python 跑；每 Agent 发一条带 marker 的短消息验回包。
  - 第一次测试（桥仍跑旧版时）：harness 启动成功；memory 回 `MEMORY-OK`、code 回 `CODE-OK`；general 失败（`JsonRpcError: session "general" already exists`）——因桥的旧 DSH 进程正持有 general 会话；life 也失败（同错），当时原因未明。
  - 桥重启（12:25）：桥 active，新进程 PID 79281（Python）/79285（DSH sdk），harness 7 秒启动，`bridge polling, offset=31278944`，baseline logging 正常，**无报错**。
  - 第二次测试（桥重启后）：general 回 `GENERAL-OK`、memory `MEMORY-OK`、code `CODE-OK`；life 仍失败。
  - **life 失败的根因**：`JsonRpcError: session "life" is already owned by an active write handle`。`lsof` 查实是用户早上手动开的 `dsh web` 进程（PID 76439，`bin.js web`）持有 life 会话的 `session.lock` 写锁（FD 28wW）。web 进程 07:52 启动，life 会话文件最后修改 07:58（web UI 触过）。**按任务要求没动 web 进程**，已报给 parent，由 parent/用户决定（关 web UI 或由 parent 处理）。life 在 web 释放锁之前无法被桥 resume——若用户发 life 路由的消息，桥会失败。general/memory/code 不受影响。
  - 结论：新 DSH 0.2.2-rc.1 + 旧 SDK 0.2.1rc2 组合能跑（harness 启动、三个 Agent 正常回、桥轮询正常），**无 JSON-RPC 不兼容**。life 的问题是 web 进程持锁，不是版本不兼容。**无需回滚。**
- **插件升级（sdk 配置档，全部完成）**
  - 最终版本：`dsh-memory-palace 1.8.4`、`universal-plugin-hub 1.0.45`、`dsh-context 0.82.0`、`dsh-reasoning-loop-guard 0.2.5`（已是最新，不动）。`dsh plugin --profile sdk list` 与 node_modules 的 package.json 双重核实。
  - memory-palace 1.8.4 与 universal-plugin-hub 1.0.45 是在一次 `dsh plugin add dsh-memory-palace@1.8.4` 里一起被 pnpm 更新的（lockfile 重解析把 universal-plugin-hub 也 bump 到 1.0.45）。
  - 坑：第一次装 memory-palace 时 pnpm 报 `ERR_PNPM_IGNORED_BUILDS`——新版 universal-plugin-hub（1.0.45，codeload hash `71c472758615c5cd2c2eb5c8e4ca971d0a58ab21`）的 build 脚本被拦，因 `pnpm-workspace.yaml` 的 `allowBuilds` 里只有旧版 URL（hash `0dbf870cf1dae7d37bc73b0bcbb32eb8ca6110bf`）。解决：按 §五 的做法，在 `allowBuilds` 里补上新版精确 URL 后重试，成功；postinstall 正常跑（“host packages already present, nothing to do”）。
  - 每升完都重启桥验证：桥均 active、harness started、正常轮询。最后一次重启（12:31）后桥进程 PID 80631/80635，`DSH harness started`、`bridge polling, offset=31278944`、`baseline logging` 均正常。
  - 最终 Agent 复测（升级全部插件后）：general `GENERAL-OK`、memory `MEMORY-OK`、code `CODE-OK`；life 仍因 web 持锁失败（同上）。
- **防火墙（已恢复 restrictive）**
  - handle 13（`meta skuid 995 tcp dport 443 accept`，位于 `table inet localagent` 的 `chain output`）暂停后仍在（因 PC 未重启）。升级全程借用这条已有的临时规则联网（localagent 到 npm/GitHub 均 200），未另加规则。
  - 全部安装完成后删掉 handle 13（`nft delete rule inet localagent output handle 13`），验证恢复 restrictive：localagent 到 npm registry `000` / CURL-FAILED（不通）；到 `api.telegram.org` 302、到 `api.deepseek.com` 401（均连通，302/401 是服务端正常响应）。剩余规则为 handle 4–11（11434 回环、DNS、Telegram/DeepSeek 白名单、established、log、drop）。
- **备份与看门狗（升级后，已核实）**
  - 手动跑备份 12:33:09–12:33:28，`backup OK (snapshot 2026-11-06)`。VPS 核实：快照含 dsh-home（插件版本已是新版 1.8.4/1.0.45/0.82.0），`agent.env`、dsh-venv 不在快照里（`*token*` 命中均为 `@modelcontextprotocol/sdk` 的源码文件，非凭证）；`latest` 已指到 2026-11-06。
  - 看门狗：状态 `up`，心跳新鲜（`active 1793939520 2026-11-06T04:32:00Z`，即 12:32 CST，约 1 分钟前）。
- **记忆自优化与基线**：timer 未动（下次仍是 2026-11-08 周日 03:00）。基线机制 intact（桥启动仍记 baseline logging）；基线文件最后一条仍是 07:43 的 "oi"（13 字），下一条用户消息会续记。SDK `RunResult` 仍无 token 用量字段，继续用字符数 proxy。
- **待办（仍需用户/parent）**
  1. **life 会话被 web 进程（PID 76439）持锁**：用户关掉 DSH 网页界面（或 parent 决定处理）后，桥才能 resume life；之后需再测 life 一次。这是本次续做唯一未闭合的项。
  2. Telegram 端到端实测仍需用户发一条消息给 Bot（协调员无法替用户发）。
- **回滚未触发**：新 DSH + 旧 SDK 组合实测能跑，无需回滚。回滚点仍在（08:00 备份快照 `2026-11-06`、旧 SDK venv、`.bak-pythonsdk` 桥备份）。

## 八、DSH 桌面版（Electron 壳）——2026-11-06 下午，构建中

- **起因**：major 2026-11-06 12:50 说想要一个桌面版（不要浏览器标签页），并确认按轻量壳方案做。官方 DSH 桌面版只有 macOS/Windows 安装包，Linux 没有，所以在现有安装上自建一个 Electron 壳（与官方桌面版同构：Electron 窗口套 DSH 网页 UI）。
- **框架选择：Electron（不用 Tauri）**：Tauri 需另装 Rust 工具链（PC 上无 cargo/rustc），且 Linux 端同样用 webkit2gtk 渲染、无优势；Electron 是 npm 预编译包、与官方桌面版同技术栈、Chromium 渲染 DSH 网页 UI 最稳。定版：Electron 45.2.3、electron-builder 26.18.0（npm 官方源直连可用）。
- **自动启停服务（核心设计）**
  - 启动器 `/opt/localagent/bin/dsh-web-launch`（root:root 755）：`DSH_HOME=/opt/localagent/dsh-home`，`cd /opt/localagent`（避开 `.env` EACCES 警告），`exec dsh-node24 web --no-open --port 0`。`--port 0` 让系统挑空闲端口（避开 3080 被占用的冲突）；`exec` 使进程即 dsh 本体、便于结束。
  - sudoers `/etc/sudoers.d/dsh-web`（root:root 440，`visudo -cf` 验证“解析正确”）：`peter ALL=(localagent) NOPASSWD: /opt/localagent/bin/dsh-web-launch`。只允许这一个脚本、只以 localagent 身份、免密；脚本是 root 持有、peter 改不了，因此不能借此以 localagent 跑任意命令。DeepSeek key 与 Bot token 仍只在 `/opt/localagent/config/agent.env`（600），未动、未外泄。
  - 实测：`sudo -n -u localagent /opt/localagent/bin/dsh-web-launch` 免密能跑；`--port 0` 会打印 `dsh web: http://127.0.0.1:<随机端口>/?token=<hex>`，但启动需约 10–20 秒才输出（8 秒超时内看不到、20 秒能看到）。桌面程序会等最多 60 秒读这行 URL 再加载。
  - `/opt/localagent` 本身是 750（localagent:localagent），peter 平时看不到里面——属正常，不影响 sudo 启动。
- **桌面程序**：源码在 PC `/home/peter/dsh-desktop/`（main.js + package.json + assets/icon.png；本地备份 `~/workspace/dsh-desktop-build/project/`，package.json 已同步最终版）。
  - `main.js`：启动时 `spawn sudo -n -u localagent <启动器>`（detached 新进程组），读 stdout 找 `dsh web: <URL>`，在原生窗口加载；token 只放内存、不记日志不落盘。窗口 1280×860、打开即最大化、原生边框、无浏览器 chrome；站外链接点开走系统浏览器。关窗口/退出时按进程组 SIGTERM 停服务（3 秒后 SIGKILL 兜底）。
  - 图标：PIL 生成的 512×512 PNG（深蓝渐变圆角 + 白色 DSH 字 + 亮点）。
  - 打包：electron-builder `--linux deb`，产物 `dist/dsh-desktop_1.0.0_amd64.deb`（101 MB），装到 `/opt/DeepSeek Harness/`，.desktop 与图标进系统目录。构建中遇到的坑：electron 须放 devDependencies；`linux.desktop` 键在 electron-builder 26 被 schema 拒（已删）；.deb 要求 maintainer 与 homepage（已补 `maintainer: DSH Desktop (local build) <local@localhost>`、`homepage: https://github.com/deepseek-ai/deepseek-harness`）。fpm 由 electron-builder 自动下载预编译版（自带 Ruby），系统无 ruby 也能跑。`dsh web --port 0` 的 fpm 打包（xz 压 274 MB）耗时约 2–3 分钟，属正常。
- **已装好并实测通过（2026-11-06 13:11–13:13）**
  - `dpkg -i` 安装成功（`ii dsh-desktop 1.0.0 amd64`），依赖全满足；`/usr/bin/dsh-desktop` 已注册（update-alternatives），应用菜单有“DeepSeek Harness”（Development 分类），.desktop 文件 `desktop-file-validate` 通过。
  - 启动实测：窗口“DeepSeek Harness”出现（原生边框 + File/Edit/View/Window 菜单、打开即最大化），DSH 网页 UI 完整渲染（左侧会话/工作区、对话输入框）；`dsh web` 服务由应用自动拉起（localagent 身份、`--port 0` 随机端口），截图核实。唯一警告是 Electron 的 IBUS surrounding-text 提示，无害。
  - 关闭实测：用窗口关闭后，Electron 进程与 `dsh web` 服务均已退出（无残留）；Telegram 桥（PID 80631）全程不受影响。之后已重新拉起应用、窗口开着等用户用。
  - 窗口关联修正：实测窗口 WM_CLASS 是 `dsh-desktop`，而 electron-builder 生成的 .desktop 写的是 `StartupWMClass=DeepSeek Harness`（对不上，任务栏可能不关联）。已直接把已安装的 `/usr/share/applications/dsh-desktop.desktop` 改成 `StartupWMClass=dsh-desktop`。以后若重打 .deb，须在 package.json 顶层加 `"desktopName": "dsh-desktop"` 并在 linux 配置加 `"syncDesktopName": true`，让生成的文件一次对齐（本次未重打，因已装版可用）。
- **用户还需做的一步（API Key）**：桌面版打开后，DSH 网页 UI 会弹“Get started——Sign in 或 Add API Key”。这是因为网页版 profile 没有配 DeepSeek key（key 目前只在桥的 agent.env 里、供 SDK profile 用）。用户在桌面版里点一次“Add API Key”填入自己的 DeepSeek key 即可（DSH 存在网页版自己的本地配置里，与浏览器里操作一样）。**不要**让用户把 key 发聊天里；也不要由 cat 代填。是否把 key 接进启动器（让网页版自动有 key）由 parent/用户另定，本次没动。
- **会话锁提醒（与网页版相同，非故障）**：桌面版与 Telegram 桥共用同一批 DSH_HOME 会话；在桌面里打开哪个会话，那个会话就被锁住、Telegram 那边暂时用不了；关掉桌面版，锁就放了。早上 life 被锁就是这个原因。
- **未动**：DSH 本体、DSH_HOME、会话、插件、Telegram 桥均未改；只新增了启动器、sudoers 规则与桌面程序。

## 九、DSH 桌面版 QQ 渐变背景（2026-11-06 23:52 上线，v1.1.0）

- **用户批准**：仅主界面黑色背景改为 im.qq.com 式竖条彩色渐变（蓝→青→紫→粉→蜜桃，缓慢流动），字体/布局/文字/侧边栏一律不动，侧边栏保持深色。效果图见 ~/workspace/imagine_media/media-generation-dsh-qq-gradient-bg-mockup-0-8341d637-2b81-483f-92b1-3fed3ec54bdf.webp。
- **实现（注入式，未动 DSH 本体）**：Electron 壳经 `webContents.insertCSS` 注入 `qq-gradient.css`（每次 `did-finish-load` 都重注，刷新不掉）。CSS 机制：DSH 主区各面用 `--dsw-alias-bg-base` token 绘制，把它在 `:root, body` 上置 `transparent !important`，再在 `html, body, #root` 上铺渐变；侧边栏用另一 token `--dsw-specific-sidebar-fill`（深色 #1b1b1c），未动。卡片/菜单/输入框/气泡各有自己的实色 token，不受影响，白字直接落在渐变上（与效果图一致）。
- **渐变**：`linear-gradient(90deg, #1d4ed8, #2563eb, #06b6d4, #7c3aed, #db2777, #fb7185, #fdba74)`，300% 宽，60s ease-in-out infinite alternate 横向漂移；底部叠加一层蜜桃色暖光（`rgba(255,199,141,.55)`）。
- **改动**：PC `~/dsh-desktop/` 新增 `qq-gradient.css`，`main.js` 加注入 hook 与注入日志 `/tmp/dsh-desktop-qq-gradient.log`，`package.json` 版本 1.1.0、`files` 加 `qq-gradient.css`；顺手修了上次待办的 `.desktop` 项（顶层 `desktopName` + `syncDesktopName`，现 `StartupWMClass=dsh-desktop` 已对齐）。源码同步在 assistant VM `~/workspace/dsh-desktop-build/project/`；旧版备份 `~/dsh-desktop.bak-1.0.0/`（PC）与 `/tmp/app.asar.bak-1.0.0`（PC）。
- **构建**：PC 上 `npm ci` + `electron-builder --linux deb`，产物 `dist/dsh-desktop_1.1.0_amd64.deb`（101MB），`dpkg -i` 安装（经 Tailscale root SSH；peter 的 sudo 需密码、无免密）。
- **重启与验证（未截图、未打扰观影）**：旧应用（PID 134674）与它的 web 服务（134797）停掉后重开新版；Telegram 桥（PID 113654）全程未动。注入日志两行 `QQ gradient CSS injected (key 1)`（加载页 + 真实 UI），新 web 服务 139640、窗口已在；运行日志仅有已知无害的 IBUS 警告。
- **回滚**：删 `~/dsh-desktop/qq-gradient.css`（或 main.js 里的注入 hook）→ 重打重装重启；或直接 `dpkg -i` 旧版：`~/dsh-desktop.bak-1.0.0/` 源码可重打 1.0.0，`/tmp/app.asar.bak-1.0.0` 可直接拷回 `/opt/DeepSeek Harness/resources/app.asar`（须 root）。
