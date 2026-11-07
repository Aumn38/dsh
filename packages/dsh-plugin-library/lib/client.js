// dsh-plugin-library — 插件库客户端。
//
// 在 DSH 左侧栏加一个「插件库」入口，点进去是两层结构：
//   第一层：两个入口——「官方」和「非官方」。
//     「官方」：DSH 官方预装的插件（@deepseek-ai/* 核心包）。
//     「非官方」：后装的插件（总控台、Skill 库、安全网、上下文压缩等）。
//   点进去是第二层：该分类下的插件列表。
//
// 样式照 DSH 官方「插件」设置页（内置插件配置 / 实验性插件）那种风格：
// 每条插件是一行——左边一个浅色圆角方块里的图标，右边标题 + 说明 + 版本/来源，
// 干净清爽，不用深色毛玻璃大卡片。
//
// 实现走 DSH 官方客户端 API（仿照 dsh-control-panel，0.2.2-rc.1）：
//   - 主面板 + 左侧栏入口：ctx.slots.inject("main") / ("sidebar.panellist")
//   - 插件数据：本机 8899 端口 skill-library 服务的 /api/plugins（JSON，带 CORS），
//     打开面板时拉取（先试 127.0.0.1，不通再试内网 IP），刷新按钮可重新拉取。
//
// 注意：client 侧只能 require("react")；不要按包内路径取资源、不要相对 require。
window.__ModuleLoader__.load({
  id: "dsh-plugin-library",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");

    const NS = "plugin-library";
    const PANEL_ID = "plugin-library";

    const API_URLS = [
      "http://127.0.0.1:8899/api/plugins",
      "http://100.119.90.121:8899/api/plugins",
    ];

    const API_ACTION_URLS = [
      "http://127.0.0.1:8899/api/plugins/action",
      "http://100.119.90.121:8899/api/plugins/action",
    ];

    const zh = {
      panel: "插件库",
      title: "插件",
      subtitle: "安装、启用和配置插件",
      official: "官方",
      unofficial: "非官方",
      officialDesc: "DSH 官方预装的插件",
      unofficialDesc: "后来装的插件",
      back: "← 返回",
      loading: "正在读取插件……",
      loadFailed: "读取失败",
      retry: "重试",
      refresh: "刷新",
      total: "共 {n} 个插件",
      empty: "暂无插件",
      versionLabel: "版本",
      sourceLabel: "来源",
      profileLabel: "所在 profile",
      note: "开关 = 启用 / 停用（只改配置，不删文件）；垃圾桶 = 从 DSH 里删除（源码保留在 dsh-plugins 目录，可重新启用）。改动后重开 DSH 应用生效。官方内置插件由 DSH 自带，在此不管理；只在 SDK 里跑的插件标为 SDK，也不在此管理。",
      enabled: "已启用",
      disabled: "已停用",
      sdkOnly: "SDK",
      deleteTip: "删除这个插件",
      deleteConfirm: "确定删除插件 {n} 吗？删除后它会从 DSH 里移除，源码保留在 dsh-plugins 目录，可重新启用。",
      enabledMsg: "已启用 {n}，重开 DSH 应用生效。",
      disabledMsg: "已停用 {n}，重开 DSH 应用生效。",
      removedMsg: "已删除 {n}，源码保留，可重新启用；重开 DSH 应用生效。",
      actionFailed: "操作失败：{e}",
      working: "处理中……",
    };

    const en = {
      panel: "Plugin Library",
      title: "Plugins",
      subtitle: "Install, enable and configure plugins",
      official: "Official",
      unofficial: "Unofficial",
      officialDesc: "Official pre-installed DSH plugins",
      unofficialDesc: "Plugins installed later",
      back: "← Back",
      loading: "Loading plugins…",
      loadFailed: "Failed to load",
      retry: "Retry",
      refresh: "Refresh",
      total: "{n} plugins in total",
      empty: "No plugins here yet",
      versionLabel: "Version",
      sourceLabel: "Source",
      profileLabel: "Profile",
      note: "Switch = enable / disable (config only, files kept); trash = remove from DSH (source kept in dsh-plugins, can be re-enabled). Reopen the DSH app for changes to take effect. Built-in official plugins are part of DSH and not managed here; SDK-only plugins are marked SDK and also not managed here.",
      enabled: "Enabled",
      disabled: "Disabled",
      sdkOnly: "SDK",
      deleteTip: "Remove this plugin",
      deleteConfirm: "Remove plugin {n}? It will be removed from DSH; its source stays in dsh-plugins and can be re-enabled.",
      enabledMsg: "Enabled {n}. Reopen the DSH app for it to take effect.",
      disabledMsg: "Disabled {n}. Reopen the DSH app for it to take effect.",
      removedMsg: "Removed {n}. Source kept, can be re-enabled. Reopen the DSH app for it to take effect.",
      actionFailed: "Action failed: {e}",
      working: "Working…",
    };

    // ---- 拉取插件数据（按顺序试两个地址） ----
    function fetchPlugins() {
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

    // ---- 启用 / 停用 / 删除（POST 到同一服务，按顺序试两个地址） ----
    function postAction(action, name) {
      let chain = Promise.reject(new Error("no url"));
      API_ACTION_URLS.forEach((u) => {
        chain = chain.catch(() =>
          fetch(u, {
            method: "POST", mode: "cors",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action, name }),
          }).then((r) => r.json().then((d) => {
            if (!r.ok || !d.ok) throw new Error((d && d.error) || ("HTTP " + r.status));
            return d;
          }))
        );
      });
      return chain;
    }

    function truncate(text, max) {
      if (!text) return "";
      const s = String(text).replace(/\s+/g, " ").trim();
      return s.length > max ? s.slice(0, max) + "…" : s;
    }

    // ---- 象形图标（官方插件页那种线条小图标，不是字母） ----
    // 每个 key 一支 24x24 描边 SVG；官方风格：描边 #679EFE（DeepSeek 蓝）、
    // 透明底、无渐变，40x40 显示，和官方 icon.svg 原图一致。
    function svgIcon(key) {
      const common = { width: "28", height: "28", viewBox: "0 0 24 24", fill: "none", stroke: "#679EFE", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round", style: { display: "block", flex: "none" } };
      const paths = {
        search: [
          react.createElement("circle", { key: "c", cx: "11", cy: "11", r: "7" }),
          react.createElement("line", { key: "l", x1: "16.5", y1: "16.5", x2: "21", y2: "21" }),
        ],
        terminal: [
          react.createElement("rect", { key: "r", x: "3", y: "4", width: "18", height: "16", rx: "2" }),
          react.createElement("polyline", { key: "p", points: "7 9 10 12 7 15" }),
          react.createElement("line", { key: "l", x1: "13", y1: "15", x2: "17", y2: "15" }),
        ],
        loop: [
          react.createElement("path", { key: "p", d: "M21 12a9 9 0 1 1-2.64-6.36" }),
          react.createElement("polyline", { key: "l", points: "21 3 21 9 15 9" }),
        ],
        subagent: [
          react.createElement("rect", { key: "a", x: "2.5", y: "2.5", width: "12", height: "12", rx: "2.5", stroke: "#679EFE" }),
          react.createElement("rect", { key: "b", x: "9.5", y: "9.5", width: "12", height: "12", rx: "2.5", stroke: "#8b5cf6" }),
        ],
        team: [
          react.createElement("circle", { key: "a", cx: "9", cy: "8", r: "3.2" }),
          react.createElement("path", { key: "b", d: "M3.5 19c.6-3 2.8-4.5 5.5-4.5S13.9 16 14.5 19" }),
          react.createElement("circle", { key: "c", cx: "17", cy: "9", r: "2.4" }),
          react.createElement("path", { key: "d", d: "M15.5 14.6c2.3.3 4 1.7 4.5 4.4" }),
        ],
        mic: [
          react.createElement("rect", { key: "r", x: "9", y: "2.5", width: "6", height: "11", rx: "3" }),
          react.createElement("path", { key: "p", d: "M5.5 11a6.5 6.5 0 0 0 13 0" }),
          react.createElement("line", { key: "l", x1: "12", y1: "17.5", x2: "12", y2: "21" }),
        ],
        grid: [
          react.createElement("rect", { key: "a", x: "3.5", y: "3.5", width: "7", height: "7", rx: "1.5" }),
          react.createElement("rect", { key: "b", x: "13.5", y: "3.5", width: "7", height: "7", rx: "1.5" }),
          react.createElement("rect", { key: "c", x: "3.5", y: "13.5", width: "7", height: "7", rx: "1.5" }),
          react.createElement("rect", { key: "d", x: "13.5", y: "13.5", width: "7", height: "7", rx: "1.5" }),
        ],
        shield: [
          react.createElement("path", { key: "p", d: "M12 2.5l7.5 2.8v6c0 4.8-3.2 8.6-7.5 10.2-4.3-1.6-7.5-5.4-7.5-10.2v-6L12 2.5z" }),
          react.createElement("polyline", { key: "c", points: "8.8 12 11 14.2 15.2 9.8" }),
        ],
        worktree: [
          react.createElement("line", { key: "a", x1: "6", y1: "3", x2: "6", y2: "15" }),
          react.createElement("circle", { key: "b", cx: "18", cy: "6", r: "2.6" }),
          react.createElement("circle", { key: "c", cx: "6", cy: "18", r: "2.6" }),
          react.createElement("path", { key: "d", d: "M18 8.6a8.5 8.5 0 0 1-8.5 6.9" }),
        ],
        puzzle: [
          react.createElement("path", { key: "p", d: "M10 3.5h4a1.5 1.5 0 0 1 1.5 1.5c1.8.3 3 1.6 3 3.5a1.5 1.5 0 0 1 1.5 1.5v4a1.5 1.5 0 0 1-1.5 1.5c-.3 1.8-1.6 3-3.5 3a1.5 1.5 0 0 1-1.5 1.5h-4a1.5 1.5 0 0 1-1.5-1.5c-1.8-.3-3-1.6-3-3.5A1.5 1.5 0 0 1 4 14v-4a1.5 1.5 0 0 1 1.5-1.5c.3-1.8 1.6-3 3.5-3A1.5 1.5 0 0 1 10 3.5z" }),
          react.createElement("circle", { key: "o", cx: "12", cy: "12", r: "2.2" }),
        ],
        core: [
          react.createElement("path", { key: "p", d: "M12 2.5l8 4.5v9l-8 4.5L4 16V7l8-4.5z" }),
          react.createElement("path", { key: "i", d: "M12 7v10M4 7l8 5 8-5" }),
        ],
        book: [
          react.createElement("rect", { key: "r", x: "4.5", y: "3", width: "15", height: "18", rx: "2" }),
          react.createElement("line", { key: "s", x1: "9", y1: "3", x2: "9", y2: "21" }),
        ],
        layers: [
          react.createElement("polyline", { key: "a", points: "12 3 21 8 12 13 3 8" }),
          react.createElement("polyline", { key: "b", points: "3 12 12 17 21 12" }),
          react.createElement("polyline", { key: "c", points: "3 16 12 21 21 16" }),
        ],
      };
      const kids = paths[key] || paths.puzzle;
      return react.createElement("svg", common, kids);
    }

    // ---- 垃圾桶小图标（删除按钮用，18px，柔和的红） ----
    function trashIcon() {
      return react.createElement("svg", {
        width: "18", height: "18", viewBox: "0 0 24 24", fill: "none",
        stroke: "#f87171", strokeWidth: "2", strokeLinecap: "round", strokeLinejoin: "round",
        style: { display: "block", flex: "none" },
        "aria-hidden": "true", focusable: "false",
      }, [
        react.createElement("polyline", { key: "a", points: "3 6 5 6 21 6" }),
        react.createElement("path", { key: "b", d: "M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" }),
        react.createElement("line", { key: "c", x1: "10", y1: "11", x2: "10", y2: "17" }),
        react.createElement("line", { key: "d", x1: "14", y1: "11", x2: "14", y2: "17" }),
      ]);
    }

    // ---- 启用 / 停用开关 ----
    function ToggleSwitch(props) {
      const on = !!props.on;
      const busy = !!props.busy;
      return react.createElement("button", {
        onClick: props.onClick,
        disabled: busy,
        title: on ? "已启用，点一下停用" : "已停用，点一下启用",
        style: {
          cursor: busy ? "wait" : "pointer",
          flex: "none", width: "38px", height: "22px", borderRadius: "999px",
          border: "1px solid rgba(255,255,255,0.25)",
          background: on ? "#34d399" : "rgba(255,255,255,0.18)",
          position: "relative", padding: 0, opacity: busy ? 0.6 : 1,
        },
      }, [
        react.createElement("span", {
          key: "knob",
          style: {
            position: "absolute", top: "2px", left: on ? "18px" : "2px",
            width: "16px", height: "16px", borderRadius: "50%",
            background: "#fff", display: "block",
          },
        }),
      ]);
    }

    // ---- 左侧栏图标：四格拼图 ----
    function PluginLibraryIcon(props) {
      return react.createElement("svg", {
        width: "18", height: "18", viewBox: "0 0 18 18", fill: "none",
        "aria-hidden": "true", focusable: "false",
        style: { display: "block", flex: "none" },
        ...(props || {}),
      }, [
        react.createElement("rect", { key: "a", x: "2", y: "2", width: "6", height: "6", rx: "1.5", stroke: "currentColor", strokeWidth: "1.4" }),
        react.createElement("rect", { key: "b", x: "10", y: "2", width: "6", height: "6", rx: "1.5", stroke: "currentColor", strokeWidth: "1.4" }),
        react.createElement("rect", { key: "c", x: "2", y: "10", width: "6", height: "6", rx: "1.5", stroke: "currentColor", strokeWidth: "1.4" }),
        react.createElement("rect", { key: "d", x: "10", y: "10", width: "6", height: "6", rx: "1.5", stroke: "currentColor", strokeWidth: "1.4" }),
      ]);
    }

    const styles = {
      page: {
        display: "flex", flexDirection: "column", minHeight: "100%",
        padding: "28px 32px 32px", boxSizing: "border-box",
        color: "rgba(255,255,255,0.95)", overflowY: "auto",
      },
      header: { marginBottom: "8px" },
      h1: { margin: "0 0 6px", fontSize: "24px", lineHeight: "1.3", fontWeight: 700, color: "rgba(255,255,255,0.96)", textShadow: "0 1px 3px rgba(15,23,42,0.35)" },
      sub: { margin: 0, fontSize: "13px", lineHeight: "1.6", color: "rgba(255,255,255,0.72)", textShadow: "0 1px 2px rgba(15,23,42,0.35)" },
      topRow: { display: "flex", gap: "8px", flexWrap: "wrap", margin: "12px 0 20px" },
      refreshBtn: {
        cursor: "pointer", fontSize: "13px", fontWeight: 600,
        color: "rgba(255,255,255,0.85)", background: "transparent",
        border: "1px solid rgba(255,255,255,0.25)", borderRadius: "999px",
        padding: "7px 14px", marginLeft: "auto",
      },
      tab: {
        cursor: "pointer", fontSize: "13px", fontWeight: 600,
        color: "rgba(255,255,255,0.85)", background: "rgba(255,255,255,0.08)",
        border: "1px solid rgba(255,255,255,0.18)", borderRadius: "999px",
        padding: "7px 14px",
      },
      sectionTitle: {
        margin: "20px 0 12px", fontSize: "15px", fontWeight: 700,
        color: "rgba(255,255,255,0.92)", textShadow: "0 1px 2px rgba(15,23,42,0.35)",
      },
      row: {
        display: "flex", gap: "14px", alignItems: "flex-start",
        padding: "14px 16px", borderRadius: "14px", marginBottom: "10px",
        background: "rgba(255,255,255,0.07)",
        border: "1px solid rgba(255,255,255,0.10)",
        cursor: "pointer",
      },
      rowStatic: {
        display: "flex", gap: "14px", alignItems: "flex-start",
        padding: "14px 16px", borderRadius: "14px", marginBottom: "10px",
        background: "rgba(255,255,255,0.07)",
        border: "1px solid rgba(255,255,255,0.10)",
      },
      icon: {
        flex: "none", width: "40px", height: "40px", borderRadius: "10px",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: "18px", fontWeight: 700, color: "rgba(255,255,255,0.95)",
      },
      rowBody: { flex: "1 1 auto", minWidth: 0 },
      rowTitle: { fontSize: "15px", fontWeight: 700, lineHeight: "1.35", color: "rgba(255,255,255,0.96)" },
      rowDesc: { marginTop: "3px", fontSize: "13px", lineHeight: "1.55", color: "rgba(255,255,255,0.72)" },
      rowMeta: { marginTop: "4px", fontSize: "12px", color: "rgba(255,255,255,0.5)" },
      backBtn: {
        cursor: "pointer", fontSize: "13px", fontWeight: 600,
        color: "rgba(255,255,255,0.85)", background: "transparent",
        border: "1px solid rgba(255,255,255,0.25)", borderRadius: "999px",
        padding: "7px 14px", margin: "0 0 16px", alignSelf: "flex-start",
      },
      empty: { fontSize: "13px", color: "rgba(255,255,255,0.55)" },
      note: { marginTop: "20px", fontSize: "12px", color: "rgba(255,255,255,0.5)", textShadow: "0 1px 2px rgba(15,23,42,0.35)" },
      status: { marginTop: "12px", fontSize: "13px", lineHeight: "1.5", color: "rgba(255,255,255,0.9)", textShadow: "0 1px 2px rgba(15,23,42,0.35)" },
      badge: {
        display: "inline-block", fontSize: "11px", fontWeight: 700, lineHeight: "1",
        padding: "4px 8px", borderRadius: "999px", marginLeft: "8px",
        verticalAlign: "middle",
      },
      badgeOn: { background: "rgba(52,211,153,0.22)", color: "#6ee7b7" },
      badgeOff: { background: "rgba(255,255,255,0.14)", color: "rgba(255,255,255,0.65)" },
      badgeSdk: { background: "rgba(103,158,254,0.22)", color: "#93c5fd" },
      rowDisabled: { opacity: 0.55 },
      controls: { flex: "none", display: "flex", alignItems: "center", gap: "10px" },
      trashBtn: {
        cursor: "pointer", background: "transparent", border: "none",
        padding: "4px", display: "flex", alignItems: "center",
      },
    };

    // 官方插件页风格：图标坐在 40x40 浅色圆角方块里（白底），和官方
    // 「插件」设置页的图标底座一致；图标本身用 #679EFE 描边。
    function iconStyle(name) {
      return { ...styles.icon, background: "rgba(255,255,255,0.92)" };
    }
    // 插件用的象形图标 key：内置插件用服务端给的 icon；非官方插件按名字
    // 取一个贴切的图标（dsh-context / dsh-reasoning-loop-guard 有自带 icon.svg
    // 时走 <img> 原图，这里的映射只是回退）；官方核心包用 core；其余用 puzzle。
    function iconKeyFor(p) {
      if (p && p.icon) return p.icon;
      const byName = {
        "dsh-control-panel": "grid",
        "dsh-memory-palace": "book",
        "dsh-skill-library": "layers",
        "dsh-plugin-library": "puzzle",
        "billion-context": "core",
        "cc-safety-net": "shield",
        "dsh-context": "layers",
        "dsh-reasoning-loop-guard": "loop",
      };
      if (p && p.name && byName[p.name]) return byName[p.name];
      if (p && String(p.name || "").indexOf("@deepseek-ai/") === 0) return "core";
      return "puzzle";
    }

    // ---- 官方插件风格的一行：图标 + 标题 + 说明 + 开关 / 删除 ----
    // 有官方 icon.svg 原图的直接用原图；没有的用按官方风格重画的象形图标。
    // 可管理的插件（非官方、后装的）右侧有开关（启用/停用）与垃圾桶（删除）；
    // 已停用的整行变淡；官方内置与只在 SDK 里跑的插件没有开关与删除。
    function PluginRow(props) {
      const p = props.plugin;
      const t = props.t;
      const manageable = !!p.manageable;
      const enabled = !!p.enabled;
      const busy = props.busyName === p.name;
      const meta = [];
      if (p.version) meta.push(t("versionLabel") + " " + p.version);
      if (p.source) meta.push(p.source);
      if (p.profiles && p.profiles.length) meta.push(p.profiles.join(" / "));
      const iconEl = p.icon_svg
        ? react.createElement("div", { style: iconStyle(p.name) },
            react.createElement("img", {
              src: p.icon_svg, alt: "",
              style: { width: "32px", height: "32px", display: "block", flex: "none" },
            }))
        : react.createElement("div", { style: iconStyle(p.name) }, svgIcon(iconKeyFor(p)));
      // 状态小标签：可管理的显示已启用/已停用；只在 SDK 里的显示 SDK；官方内置不显示。
      let badge = null;
      if (manageable) {
        badge = react.createElement("span", {
          key: "badge",
          style: { ...styles.badge, ...(enabled ? styles.badgeOn : styles.badgeOff) },
        }, enabled ? t("enabled") : t("disabled"));
      } else if (p.profiles && p.profiles.indexOf("sdk") >= 0 && p.profiles.indexOf("web") < 0) {
        badge = react.createElement("span", {
          key: "badge",
          style: { ...styles.badge, ...styles.badgeSdk },
        }, t("sdkOnly"));
      }
      const controls = manageable
        ? react.createElement("div", { key: "ct", style: styles.controls }, [
            react.createElement(ToggleSwitch, {
              key: "sw", on: enabled, busy,
              onClick: () => props.onToggle && props.onToggle(p),
            }),
            react.createElement("button", {
              key: "del", title: t("deleteTip"), disabled: busy,
              onClick: () => props.onDelete && props.onDelete(p),
              style: { ...styles.trashBtn, opacity: busy ? 0.5 : 0.9, cursor: busy ? "wait" : "pointer" },
            }, trashIcon()),
          ])
        : null;
      const rowStyle = (manageable && !enabled)
        ? { ...styles.rowStatic, ...styles.rowDisabled }
        : styles.rowStatic;
      return react.createElement("div", { style: rowStyle }, [
        react.createElement("div", { key: "ic", style: { flex: "none", display: "flex", alignItems: "center" } }, iconEl),
        react.createElement("div", { key: "bd", style: styles.rowBody }, [
          react.createElement("div", { key: "t", style: styles.rowTitle }, [p.name, badge]),
          p.description ? react.createElement("div", { key: "d", style: styles.rowDesc }, truncate(p.description, 300)) : null,
          meta.length ? react.createElement("div", { key: "m", style: styles.rowMeta }, meta.join(" · ")) : null,
        ]),
        controls,
      ]);
    }

    // ---- 插件库主页面 ----
    function PluginLibraryPage(props) {
      const ctx = props.ctx;
      const t = ctx.locale.bind(NS);
      const [data, setData] = react.useState(null);
      const [error, setError] = react.useState(null);
      const [layer, setLayer] = react.useState(null);
      const [nonce, setNonce] = react.useState(0);
      const [busyName, setBusyName] = react.useState(null);
      const [status, setStatus] = react.useState(null);

      react.useEffect(() => {
        let alive = true;
        setError(null);
        setData(null);
        fetchPlugins()
          .then((d) => { if (alive) setData(d); })
          .catch((e) => { if (alive) setError(String((e && e.message) || e)); });
        return () => { alive = false; };
      }, [nonce]);

      // 开关：启用 / 停用（只改配置，不删文件；重开 DSH 应用生效）。
      function doToggle(p) {
        setBusyName(p.name);
        setStatus(t("working"));
        postAction(p.enabled ? "disable" : "enable", p.name)
          .then(() => {
            setStatus((p.enabled ? t("disabledMsg") : t("enabledMsg")).replace("{n}", p.name));
            setNonce((n) => n + 1);
          })
          .catch((e) => setStatus(t("actionFailed").replace("{e}", String((e && e.message) || e))))
          .finally(() => setBusyName(null));
      }

      // 垃圾桶：删除（先弹确认；从配置里移除，源码保留，可重新启用）。
      function doDelete(p) {
        if (!window.confirm(t("deleteConfirm").replace("{n}", p.name))) return;
        setBusyName(p.name);
        setStatus(t("working"));
        postAction("remove", p.name)
          .then(() => {
            setStatus(t("removedMsg").replace("{n}", p.name));
            setNonce((n) => n + 1);
          })
          .catch((e) => setStatus(t("actionFailed").replace("{e}", String((e && e.message) || e))))
          .finally(() => setBusyName(null));
      }

      const official = (data && data.official) || [];
      const unofficial = (data && data.unofficial) || [];
      const total = (data && data.total) || 0;

      let body;
      if (error) {
        body = react.createElement("div", { key: "e" }, [
          react.createElement("p", { key: "m", style: styles.empty }, t("loadFailed") + ": " + error),
          react.createElement("button", { key: "r", style: styles.tab, onClick: () => setNonce((n) => n + 1) }, t("retry")),
        ]);
      } else if (!data) {
        body = react.createElement("p", { key: "l", style: styles.empty }, t("loading"));
      } else if (layer === null) {
        // 第一层：官方 / 非官方 两个入口（官方插件页那种一行一条的风格）
        body = react.createElement("div", { key: "layers" }, [
          react.createElement("p", { key: "c", style: styles.sub }, t("total").replace("{n}", String(total))),
          react.createElement("div", { key: "off", style: styles.sectionTitle }, t("official")),
          react.createElement("div", {
            key: "offBtn", style: styles.row,
            onClick: () => setLayer("official"),
          }, [
            react.createElement("div", { key: "ic", style: iconStyle("official") }, svgIcon("core")),
            react.createElement("div", { key: "bd", style: styles.rowBody }, [
              react.createElement("div", { key: "t", style: styles.rowTitle }, t("official")),
              react.createElement("div", { key: "d", style: styles.rowDesc }, t("officialDesc")),
              react.createElement("div", { key: "m", style: styles.rowMeta }, official.length + " 个"),
            ]),
          ]),
          react.createElement("div", { key: "unoff", style: styles.sectionTitle }, t("unofficial")),
          react.createElement("div", {
            key: "unoffBtn", style: styles.row,
            onClick: () => setLayer("unofficial"),
          }, [
            react.createElement("div", { key: "ic", style: iconStyle("unofficial") }, svgIcon("puzzle")),
            react.createElement("div", { key: "bd", style: styles.rowBody }, [
              react.createElement("div", { key: "t", style: styles.rowTitle }, t("unofficial")),
              react.createElement("div", { key: "d", style: styles.rowDesc }, t("unofficialDesc")),
              react.createElement("div", { key: "m", style: styles.rowMeta }, unofficial.length + " 个"),
            ]),
          ]),
        ]);
      } else {
        // 第二层：该分类下的插件列表（官方插件页那种一行一条）
        const list = layer === "official" ? official : unofficial;
        const title = layer === "official" ? t("official") : t("unofficial");
        const rows = list.length === 0
          ? react.createElement("p", { key: "n", style: styles.empty }, t("empty"))
          : list.map((p) => react.createElement(PluginRow, {
              key: p.name, plugin: p, t,
              busyName, onToggle: doToggle, onDelete: doDelete,
            }));
        body = react.createElement("div", { key: "list" }, [
          react.createElement("button", { key: "back", style: styles.backBtn, onClick: () => setLayer(null) }, t("back")),
          react.createElement("div", { key: "h", style: styles.sectionTitle }, title + " · " + list.length + " 个"),
          rows,
        ]);
      }

      return react.createElement("div", { style: styles.page }, [
        react.createElement("div", { key: "hd", style: styles.header }, [
          react.createElement("h1", { key: "h", style: styles.h1 }, t("title")),
          react.createElement("p", { key: "s", style: styles.sub }, t("subtitle")),
        ]),
        react.createElement("div", { key: "top", style: styles.topRow }, [
          react.createElement("button", {
            key: "__refresh",
            style: styles.refreshBtn,
            onClick: () => setNonce((n) => n + 1),
          }, t("refresh")),
        ]),
        react.createElement("div", { key: "body" }, body),
        status ? react.createElement("div", { key: "st", style: styles.status }, status) : null,
        react.createElement("div", { key: "note", style: styles.note }, t("note")),
      ]);
    }

    // ---- 隐藏官方「插件」侧栏入口（插件库已取代它） ----
    // 按可见文字精确匹配 "插件"，绝不会误伤 "插件库"（文字不同）。
    // 先以我方「插件库」入口定位侧栏，再在其祖先容器内找「插件」项；
    // 侧栏可能在插件之后才渲染，所以立即试一次 + 监听 DOM 变化 + 定时重试。
    function hideOfficialPluginsEntry() {
      const all = Array.from(document.querySelectorAll("button, a, [role='button'], [role='menuitem']"));
      const mine = all.find((el) => (el.textContent || "").trim() === "插件库");
      if (!mine) return false;
      let container = mine.parentElement;
      for (let depth = 0; depth < 5 && container; depth++) {
        const target = Array.from(container.querySelectorAll("button, a, [role='button'], [role='menuitem']"))
          .find((el) => (el.textContent || "").trim() === "插件");
        if (target) {
          target.style.display = "none";
          return true;
        }
        container = container.parentElement;
      }
      return false;
    }

    function installHideOfficialPlugins() {
      if (hideOfficialPluginsEntry()) return;
      if (typeof MutationObserver !== "undefined") {
        const observer = new MutationObserver(() => {
          if (hideOfficialPluginsEntry()) observer.disconnect();
        });
        observer.observe(document.body, { childList: true, subtree: true });
        setTimeout(() => observer.disconnect(), 30000);
      }
      const timer = setInterval(() => {
        if (hideOfficialPluginsEntry()) clearInterval(timer);
      }, 500);
      setTimeout(() => clearInterval(timer), 10000);
    }

    function apply(ctx) {
      ctx.effect(() => ctx.locale.register(NS, { zh, en }), "plugin-library: dictionaries");
      const t = ctx.locale.bind(NS);
      // 主面板：中央区域的插件库页面（总控台同款机制）。
      ctx.slots.inject("main", () => ctx.slots.register({
        name: "main",
        key: PANEL_ID,
        locale: NS,
        inject: () => ({ ctx }),
      }, PluginLibraryPage));
      // 左侧栏入口：点一下打开插件库。
      ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
        name: "sidebar.panellist",
        id: PANEL_ID,
        order: 3,
        locale: NS,
        label: () => t("panel"),
      }, PluginLibraryIcon));
      // 官方「插件」侧栏入口已由插件库取代，把它藏起来（只留「插件库」）。
      installHideOfficialPlugins();
    }

    exports.apply = apply;
    exports.inject = ["slots", "locale", "layout"];
    return module.exports;
  }
});
