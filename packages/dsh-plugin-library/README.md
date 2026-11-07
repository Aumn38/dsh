# dsh-plugin-library（插件库）

DSH 插件库：把 DSH 的插件分成「官方」和「非官方」两层。

- 第一层：两个大按钮——「官方」「非官方」。
  - 「官方」：DSH 官方预装的插件（`@deepseek-ai/*` 核心包）。
  - 「非官方」：后来装的插件（总控台、Skill 库、安全网、上下文压缩等）。
- 点进去是第二层：该分类下的插件卡片（名字、版本、说明、来源、所在 profile）。

数据来自本机 8899 端口 skill-library 服务的 `/api/plugins`（实时读 web + sdk
两个 profile 的 package.json），装新插件后点刷新即更新。

安装：`dsh plugin --profile web add file:/opt/localagent/dsh-plugins/dsh-plugin-library`
（装完需关闭重开 DSH 应用，插件无热重载）。
回滚：`dsh plugin --profile web remove dsh-plugin-library`。
