# dsh-skill-library

DSH 的 Skill 库插件（仿照 `dsh-control-panel` 的纯 UI 插件写法）。

- 在 DSH 左侧栏加一个「Skill 库」入口，点进去是 3 个 Agent（记忆 / 代码 / 生活）
  各自的 skill 与全局 skill：每张卡片显示 skill 名、来源文件、触发条件，可展开看步骤预览。
- 数据来自本机 8899 端口的 skill-library 服务（`/api/skills`，JSON），每次打开面板都重新拉取，
  新增 skill 后无需改插件，刷新即更新。
- 服务端（`lib/index.js`）只是最小占位，不注册工具、路由或投影；界面和交互全在 `lib/client.js`。

安装（以 localagent 身份）：

```bash
/opt/localagent/node24/bin/node /opt/localagent/npm-global/lib/node_modules/@deepseek-ai/dsh/lib/bin.js plugin --profile web add file:/opt/localagent/dsh-plugins/dsh-skill-library
```

改完 `lib/client.js` 后必须关掉 DSH 应用再重开才生效，没有热重载。
回滚：`dsh plugin --profile web remove dsh-skill-library`，或在应用里禁用。
