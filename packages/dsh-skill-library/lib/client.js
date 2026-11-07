// dsh-skill-library — Skill 库客户端。
//
// 在 DSH 左侧栏加一个「Skill 库」入口，点进去是 3 个 Agent（记忆 / 代码 / 生活）
// 各自的 skill 与全局 skill：每张卡片显示 skill 名、来源文件、触发条件，
// 可展开看步骤预览。顶部有四个页签（全局 / code / life / memory）切换。
//
// 实现走 DSH 官方客户端 API（仿照 dsh-control-panel，0.2.2-rc.1）：
//   - 主面板 + 左侧栏入口：ctx.slots.inject("main") / ("sidebar.panellist")
//   - skill 数据：本机 8899 端口 skill-library 服务的 /api/skills（JSON，带 CORS），
//     打开面板时拉取（先试 127.0.0.1，不通再试内网 IP），刷新按钮可重新拉取。
//
// 注意：client 侧只能 require("react")；不要按包内路径取资源、不要相对 require。
// 样式用与总控台同款的半透明毛玻璃卡片。
window.__ModuleLoader__.load({
  id: "dsh-skill-library",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");

    const NS = "skill-library";
    const PANEL_ID = "skill-library";

    const API_URLS = [
      "http://127.0.0.1:8899/api/skills",
      "http://100.119.90.121:8899/api/skills",
    ];

    const TABS = [
      { id: "global", zh: "全局", en: "Global" },
      { id: "code", zh: "code 管家", en: "Code" },
      { id: "life", zh: "life 管家", en: "Life" },
      { id: "memory", zh: "memory 管家", en: "Memory" },
    ];

    const zh = {
      panel: "Skill 库",
      title: "Skill 库",
      subtitle: "3 个管家各自的 skill 与全局 skill，点页签切换，点卡片展开看步骤。",
      loading: "正在读取 skill……",
      loadFailed: "读取失败",
      retry: "重试",
      refresh: "刷新",
      total: "共 {n} 个不同 skill",
      trigger: "触发",
      steps: "步骤预览",
      empty: "暂无 skill",
      fileLabel: "文件",
      note: "数据实时读取 DSH 的 skill 目录；新增 skill 后点刷新即更新。",
    };

    const en = {
      panel: "Skill Library",
      title: "Skill Library",
      subtitle: "Skills of your 3 agents plus the global set — switch tabs, expand a card for steps.",
      loading: "Loading skills…",
      loadFailed: "Failed to load",
      retry: "Retry",
      refresh: "Refresh",
      total: "{n} distinct skills",
      trigger: "Trigger",
      steps: "Steps preview",
      empty: "No skills yet",
      fileLabel: "File",
      note: "Read live from DSH's skill directories; refresh after adding a skill.",
    };

    // ---- 拉取 skill 数据（按顺序试两个地址） ----
    function fetchSkills() {
      let chain = Promise.reject(new Error("no url"));
      API_URLS.forEach((u) => {
        chain = chain.catch(() =>
          fetch(u, { mode: "cors" }).then((r) => {
            if (!r.ok) throw new Error("HTTP " + r.status);
            return r.json();
          })
        );
      });
      return chain;
    }

    function truncate(text, max) {
      if (!text) return "";
      const s = String(text).replace(/\s+/g, " ").trim();
      return s.length > max ? s.slice(0, max) + "…" : s;
    }

    // ---- 左侧栏图标：书本 ----
    function SkillLibraryIcon(props) {
      return react.createElement("svg", {
        width: "18", height: "18", viewBox: "0 0 18 18", fill: "none",
        "aria-hidden": "true", focusable: "false",
        style: { display: "block", flex: "none" },
        ...(props || {}),
      }, [
        react.createElement("path", { key: "a", d: "M3 2.5h7.5a2 2 0 0 1 2 2v11H5a2 2 0 0 1-2-2v-11z", stroke: "currentColor", strokeWidth: "1.4", strokeLinejoin: "round" }),
        react.createElement("path", { key: "b", d: "M12.5 15.5v-11a2 2 0 0 1 2-2H15a.5.5 0 0 1 .5.5v12.5h-3z", stroke: "currentColor", strokeWidth: "1.4", strokeLinejoin: "round" }),
        react.createElement("path", { key: "c", d: "M6 5.5h3.5M6 8h3.5", stroke: "currentColor", strokeWidth: "1.3", strokeLinecap: "round" }),
      ]);
    }

    const styles = {
      page: {
        display: "flex", flexDirection: "column", minHeight: "100%",
        padding: "28px 32px 32px", boxSizing: "border-box",
        color: "rgba(255,255,255,0.95)", overflowY: "auto",
      },
      header: { marginBottom: "16px" },
      h1: { margin: "0 0 6px", fontSize: "24px", lineHeight: "1.3", fontWeight: 700, color: "rgba(255,255,255,0.96)", textShadow: "0 1px 3px rgba(15,23,42,0.35)" },
      sub: { margin: 0, fontSize: "13px", lineHeight: "1.6", color: "rgba(255,255,255,0.72)", textShadow: "0 1px 2px rgba(15,23,42,0.35)" },
      tabs: { display: "flex", gap: "8px", flexWrap: "wrap", margin: "0 0 16px" },
      tab: {
        cursor: "pointer", fontSize: "13px", fontWeight: 600,
        color: "rgba(255,255,255,0.85)", background: "rgba(255,255,255,0.08)",
        border: "1px solid rgba(255,255,255,0.18)", borderRadius: "999px",
        padding: "7px 14px",
      },
      tabActive: {
        cursor: "pointer", fontSize: "13px", fontWeight: 700,
        color: "rgba(15,23,42,0.92)", background: "rgba(255,255,255,0.88)",
        border: "1px solid rgba(255,255,255,0.6)", borderRadius: "999px",
        padding: "7px 14px",
      },
      refreshBtn: {
        cursor: "pointer", fontSize: "13px", fontWeight: 600,
        color: "rgba(255,255,255,0.85)", background: "transparent",
        border: "1px solid rgba(255,255,255,0.25)", borderRadius: "999px",
        padding: "7px 14px", marginLeft: "auto",
      },
      card: {
        display: "flex", flexDirection: "column", gap: "8px",
        padding: "16px 18px", borderRadius: "16px", marginBottom: "12px",
        background: "rgba(15,23,42,0.45)",
        backdropFilter: "blur(16px) saturate(1.3)",
        WebkitBackdropFilter: "blur(16px) saturate(1.3)",
        border: "1px solid rgba(255,255,255,0.18)",
        boxShadow: "0 8px 24px rgba(0,0,0,0.25), inset 0 1px 0 rgba(255,255,255,0.12)",
      },
      name: { fontSize: "16px", fontWeight: 700, lineHeight: "1.3", color: "rgba(255,255,255,0.96)" },
      meta: { fontSize: "12px", color: "rgba(255,255,255,0.55)" },
      trig: { fontSize: "13px", lineHeight: "1.6", color: "rgba(255,255,255,0.85)" },
      pre: { whiteSpace: "pre-wrap", fontSize: "13px", background: "rgba(255,255,255,0.07)", padding: "10px 12px", borderRadius: "8px", overflow: "auto", color: "rgba(255,255,255,0.85)" },
      empty: { fontSize: "13px", color: "rgba(255,255,255,0.55)" },
      note: { marginTop: "20px", fontSize: "12px", color: "rgba(255,255,255,0.5)", textShadow: "0 1px 2px rgba(15,23,42,0.35)" },
    };

    // ---- 单张 skill 卡片 ----
    function SkillCard(props) {
      const s = props.skill;
      const t = props.t;
      const steps = s.steps
        ? react.createElement("details", { key: "st" }, [
            react.createElement("summary", { key: "sm", style: { cursor: "pointer", color: "rgba(255,255,255,0.85)", fontSize: "13px" } }, t("steps")),
            react.createElement("pre", { key: "pr", style: styles.pre }, s.steps),
          ])
        : null;
      return react.createElement("div", { style: styles.card }, [
        react.createElement("div", { key: "n", style: styles.name }, s.name),
        react.createElement("div", { key: "m", style: styles.meta }, t("fileLabel") + ": " + s.file + " · " + s.chars + " 字"),
        s.trigger ? react.createElement("div", { key: "g", style: styles.trig }, t("trigger") + "：" + truncate(s.trigger, 400)) : null,
        steps,
      ]);
    }

    // ---- Skill 库主页面 ----
    function SkillLibraryPage(props) {
      const ctx = props.ctx;
      const t = ctx.locale.bind(NS);
      const [data, setData] = react.useState(null);
      const [error, setError] = react.useState(null);
      const [tab, setTab] = react.useState("global");
      const [nonce, setNonce] = react.useState(0);

      react.useEffect(() => {
        let alive = true;
        setError(null);
        setData(null);
        fetchSkills()
          .then((d) => { if (alive) setData(d); })
          .catch((e) => { if (alive) setError(String((e && e.message) || e)); });
        return () => { alive = false; };
      }, [nonce]);

      const agents = (data && data.agents) || {};
      const total = (data && data.total) || 0;
      const list = agents[tab] || [];

      const tabBtns = TABS.map((tb) => {
        const count = (agents[tb.id] || []).length;
        const label = (tb.id === "global" ? t("panel") : tb.zh) + " (" + count + ")";
        return react.createElement("button", {
          key: tb.id,
          style: tab === tb.id ? styles.tabActive : styles.tab,
          onClick: () => setTab(tb.id),
        }, label);
      });
      tabBtns.push(react.createElement("button", {
        key: "__refresh",
        style: styles.refreshBtn,
        onClick: () => setNonce((n) => n + 1),
      }, t("refresh")));

      let body;
      if (error) {
        body = react.createElement("div", { key: "e" }, [
          react.createElement("p", { key: "m", style: styles.empty }, t("loadFailed") + ": " + error),
          react.createElement("button", { key: "r", style: styles.tab, onClick: () => setNonce((n) => n + 1) }, t("retry")),
        ]);
      } else if (!data) {
        body = react.createElement("p", { key: "l", style: styles.empty }, t("loading"));
      } else if (list.length === 0) {
        body = react.createElement("p", { key: "n", style: styles.empty }, t("empty"));
      } else {
        body = list.map((s) => react.createElement(SkillCard, { key: s.name, skill: s, t }));
      }

      return react.createElement("div", { style: styles.page }, [
        react.createElement("div", { key: "hd", style: styles.header }, [
          react.createElement("h1", { key: "h", style: styles.h1 }, t("title")),
          react.createElement("p", { key: "s", style: styles.sub }, t("subtitle")),
          react.createElement("p", { key: "c", style: styles.sub }, t("total").replace("{n}", String(total))),
        ]),
        react.createElement("div", { key: "tabs", style: styles.tabs }, tabBtns),
        react.createElement("div", { key: "body" }, body),
        react.createElement("div", { key: "note", style: styles.note }, t("note")),
      ]);
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "skill-library: dictionaries");
      const t = ctx.locale.bind(NS);
      // 主面板：中央区域的 Skill 库页面（总控台同款机制）。
      ctx.slots.inject("main", () => ctx.slots.register({
        name: "main",
        key: PANEL_ID,
        locale: NS,
        inject: () => ({ ctx }),
      }, SkillLibraryPage));
      // 左侧栏入口：点一下打开 Skill 库。
      ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
        name: "sidebar.panellist",
        id: PANEL_ID,
        order: 2,
        locale: NS,
        label: () => t("panel"),
      }, SkillLibraryIcon));
    }

    exports.apply = apply;
    exports.inject = ["slots", "locale", "layout"];
    return module.exports;
  }
});
