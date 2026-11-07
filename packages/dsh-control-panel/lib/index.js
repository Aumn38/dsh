// dsh-control-panel — 总控台（服务端最小占位，全部逻辑在客户端）。
//
// 设计：这是一个纯 UI 插件。服务端只注册一个最小 Cordis 服务，让 bundle 能被
// profile 正确装载；控制面板的全部功能（3 个 Agent 的实时状态、点击进入对话、
// 实时活动预览）都在 lib/client.js 里实现，走 DSH 官方客户端 API：
//   - ctx.sessions.list：会话列表快照（running / title / updatedAt，实时更新）
//   - ctx.sessions.retain + projections.faceOf('turnOutline')：实时输出预览 draft
//   - ctx.uiWorkspace.openSession：点击进入指定会话的对话
//   - ctx.layout / ctx.slots：主面板 + 左侧栏入口
import Schema from "@deepseek-ai/schemastery";

export const name = "control-panel";

export const Config = Schema.object({
  enabled: Schema.boolean().default(true).description("启用总控台插件。").volatile(),
});

export const inject = [];

export function apply(ctx, config) {
  // 纯 UI 插件：服务端不注册工具、路由或投影，控制面板全部由客户端实现。
}
