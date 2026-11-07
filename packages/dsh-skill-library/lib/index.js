// dsh-skill-library — Skill 库（服务端最小占位，全部逻辑在客户端）。
//
// 设计：纯 UI 插件，仿照 dsh-control-panel。服务端只注册一个最小 Cordis 服务，
// 让 bundle 能被 profile 正确装载；Skill 库的全部功能（读取 skill 数据、
// 按 Agent / 全局展示）都在 lib/client.js 里实现。skill 数据来自本机
// 8899 端口的 skill-library 服务（/api/skills，JSON，带 CORS），
// 由客户端直接 fetch；服务端不注册工具、路由或投影。
import Schema from "@deepseek-ai/schemastery";

export const name = "skill-library";

export const Config = Schema.object({
  enabled: Schema.boolean().default(true).description("启用 Skill 库插件。").volatile(),
});

export const inject = [];

export function apply(ctx, config) {
  // 纯 UI 插件：服务端不注册工具、路由或投影，Skill 库全部由客户端实现。
}
