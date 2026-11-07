# dsh-control-panel — 总控台

DSH 插件：在左侧栏加一个「总控台」入口，点进去是 3 个 Agent（记忆 / 代码 / 生活）
的实时状态面板。

## 每张卡片显示

- **状态**：工作中（绿点）/ 空闲（灰点）/ 未连接 / 会话不存在
- **正在干什么**：Agent 工作时显示它正在输出的实时预览（turnOutline draft）；
  空闲时显示上一轮的摘要；正在思考/调用工具时显示相应提示
- **会话标题**：该 Agent 当前对话的标题
- **最后活动**：相对时间（刚刚 / N 分钟前 / N 小时前 / N 天前）

## 点击进入对话

点整张卡片或「进入对话」按钮，直接打开该 Agent 的对话框
（`ctx.uiWorkspace.openSession(sessionId)`，与左侧会话列表点开同款）。

## 技术

- 主面板 + 左侧栏入口：`ctx.slots.inject("main")` /
  `ctx.slots.inject("sidebar.panellist")`（日程、插件管理同款机制）
- 实时状态：`ctx.sessions.list` 会话列表快照（running / title / updatedAt，
  经控制流实时更新，无需轮询）
- 实时输出预览：面板打开时 `ctx.sessions.retain` 该会话，订阅
  `projections.faceOf("turnOutline")` 的 `draft`；关闭时释放。
  任一步失败都静默降级为只显示列表数据
- 样式：半透明深色毛玻璃卡片 + 白字，与桌面端 QQ 渐变背景同款，
  不与现有 DSH 界面冲突

## 头像（v1.1.0，2026-11-07）

每张卡片的头像是真实图标（内嵌 base64，client 侧不能按包内路径取资源）：

- **记忆**：Nous Research Hermes Agent 官方应用图标（黑白漫画女孩）。
  来源：`github.com/NousResearch/hermes-agent` 的 `website/static/img/logo.png`
  （1772×1799）；另见官网 `hermes-agent.nousresearch.com/icon.png`（48×48）。
  DeepSeek API 明确不能联网搜索，图标是之后用网页搜索核实的。
- **代码**：Anthropic Claude 官方 Clawd 吉祥物（橙色像素小家伙，#D97757）。
  来源：`claude.ai/images/clawd.svg`（官方 SVG，按路径重绘成 PNG）。
  注意：Anthropic 不单独发布 Clawd 位图；Claude Code 里它是 ASCII 字符画，
  另有官方 GIF 在 `claude.ai/images/clawd/core/` 下。不要用 ClaudeWatch
  的 mascot（那是第三方应用的橙色机器人，不是 Clawd），也不要用
  clawds-new-clothes 的像素图（同人作品，带伦敦邮差套装）。
- **生活**：Muse 元神正面图。按用户提供的参考照片生成：同一件蓬松奶油色
  连体毛绒衣、同一张笑脸（黑豆豆眼、粉红脸颊），正面朝向镜头，站姿端正。
  参考图 `~/workspace/user/files/61537_6_51g2.jpg` 是 3/4 背面（屁股对镜头），
  生成版已改成正面。

## 安装

```sh
dsh plugin --profile web add file:/opt/localagent/dsh-plugins/dsh-control-panel
```

安装后默认启用（进 `dsh.profile.bundles` 末尾）。无 HMR，重启 DSH 应用后生效。
回滚：在插件管理里禁用，或 `dsh plugin --profile web remove dsh-control-panel`。

## 验证记录（2026-11-07 10:40，v1.0.0；头像 v1.1.0 更新见下）

- 服务端：`dsh --dump-config --profile web` 干净通过，`control-panel` 在
  bundle 树里，无错误/警告。`@deepseek-ai/schemastery`  peer 依赖告警是虚惊——
  DSH 的 bundle 加载器自行解析，服务正常组成。
- 客户端：`dsh.client` 声明通过 `dsh-client-modules` 的 `parseDshClient`
  校验（platform web + inject 字符串数组 + `./client` 导出子路径）。
- 客户端逻辑：Node 沙箱 harness（stub React + mock ctx）全部通过——
  注册主面板（key `control-panel`）+ 侧栏入口（id `control-panel`，order 1）；
  3 张卡片渲染（记忆/代码/生活）；状态/标题/最后活动文案；
  运行中 Agent 的实时 draft 预览 +「正在输出」；点卡片调
  `openSession("memory" / "life")`；`retain` 覆盖 3 个 Agent。
- 三份拷贝字节一致（VM 源码 / PC `/opt/localagent/dsh-plugins/` /
  web profile `node_modules/`）：client.js md5 `82301ae5719c0efb7550e6f9c2637bb9`，
  index.js md5 `625304e16151220b6e65d7fe6588040c`。
- 未验证（需他打开应用后肉眼确认）：真实浏览器里的渲染效果、真实会话的
  实时活动（沙箱里是 mock 数据）。应用当时是关着的，安装过程没有打扰他，
  桥 + SDK 正常运行。

## 验证记录（头像更新 v1.1.0，2026-11-07 11:15）

- 头像图片来源：Hermes 官方仓库 logo.png + 官网 icon.png（已下载核对，
  1772×1799 黑底透明线稿，贴白底后是漫画女孩）；Clawd 官方
  `claude.ai/images/clawd.svg`（按路径重绘，#D97757 + 黑眼睛）；生活正面图
  用参考照片生成，已肉眼确认是正面、端正、同一角色。
- `node --check lib/client.js` 通过；三份拷贝字节一致后复核
  `dsh --dump-config --profile web`（见下）。
- 三份拷贝字节一致（VM 源码 / PC `/opt/localagent/dsh-plugins/` /
  web profile `node_modules/`）：client.js md5 `c52e6605b9d17ab4d90f478f887fe809`，
  index.js md5 `625304e16151220b6e65d7fe6588040c`（未变）；版本 1.1.0。
  web profile 的 bundles 数组含 `dsh-control-panel`；`dsh --dump-config
  --profile web` 退出 0，无报错（control-panel 是纯 UI 插件，服务端不注册
  工具/路由/投影，所以 dump 的服务列表里不出现它的 id，这是正常的；
  `dsh plugin list` 因 pnpm 不在 PATH 而失败，是既有环境问题，与本次无关）。
- 头像 data URI 解码验证通过：3 张均为 144×144 PNG（Hermes 11779 字节、
  Clawd 1581 字节、Muse 22246 字节）；AGENTS 三条目均有 avatar 字段；
  旧的汉字头像渲染已移除。
- 其余逻辑未动：只换了头像渲染（彩色方块 + 汉字 → img），状态/预览/
  点击进入对话都不变。

## 备注

- 总控台只放用户点的 3 个 Agent（memory / code / life，与
  `dsh-home/sessions` 下的会话名一致）。general 是兜底，不在面板里。
- 插件不读写任何会话数据、不发消息、不改配置，只读状态 + 打开对话。
