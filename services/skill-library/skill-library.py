#!/usr/bin/env python3
"""DSH skill-library server (runs on peter-hp-old as user peter).

Reads the DSH skill files (owned by localagent, via sudo) and renders a
live skill-library page: per-agent skills (code / life / memory) plus a
global view. Listens on 0.0.0.0:8899 so it is reachable from the tailnet.

Start:  SUDO_ASKPASS=/tmp/.askpass.sh nohup python3 /home/peter/skill-library/skill-library.py >/home/peter/skill-library/server.log 2>&1 &
URL:    http://100.119.90.121:8899/
"""
import os
import re
import subprocess
import html as htmlmod
from http.server import BaseHTTPRequestHandler, HTTPServer

SKILL_DIRS = {
    "global": "/opt/localagent/dsh-workspace/skills",
    "code": "/opt/localagent/dsh-workspace/code/skills",
    "life": "/opt/localagent/dsh-workspace/life/skills",
    "memory": "/opt/localagent/dsh-workspace/memory/skills",
}
AGENT_LABELS = {
    "global": "全局 skill",
    "code": "code 管家",
    "life": "life 管家",
    "memory": "memory 管家",
}
AGENT_ORDER = ["global", "code", "life", "memory"]

ENV = {**os.environ, "SUDO_ASKPASS": "/tmp/.askpass.sh"}


def _sudo(args, timeout=15):
    r = subprocess.run(["sudo", "-A"] + args, capture_output=True, text=True,
                       timeout=timeout, env=ENV)
    return r.stdout if r.returncode == 0 else ""


def list_md_files(d):
    out = _sudo(["ls", d])
    return [x.strip() for x in out.splitlines() if x.strip().endswith(".md")]


def list_subdirs(d):
    out = _sudo(["ls", "-F", d])
    return [x.rstrip("/") for x in out.splitlines() if x.strip().endswith("/")]


def read_file(path):
    return _sudo(["cat", path])


def parse_skill(text, fname):
    m = re.search(r"^#\s*Skill[：:]\s*(.+)$", text, re.M)
    name = m.group(1).strip() if m else fname[:-3]
    m2 = re.search(r"\*\*Name:\*\*\s*(.+)$", text, re.M)
    if m2:
        name = m2.group(1).strip()
    trig = ""
    m3 = re.search(r"##\s*When to use[^\n]*\n(.*?)(?=\n##\s|\Z)", text, re.S)
    if m3:
        lines = [ln.strip("- ").strip() for ln in m3.group(1).splitlines() if ln.strip()]
        trig = " ".join(lines)[:400]
    steps = ""
    m4 = re.search(r"##\s*Steps[^\n]*\n(.*?)(?=\n##\s|\Z)", text, re.S)
    if m4:
        steps = m4.group(1).strip()[:1200]
    return {"name": name, "trigger": trig, "steps": steps,
            "file": fname, "chars": len(text)}


def scan():
    data = {}
    for agent, d in SKILL_DIRS.items():
        skills = []
        for f in list_md_files(d):
            text = read_file(os.path.join(d, f))
            if text:
                skills.append(parse_skill(text, f))
        # subdirs (e.g. memory/skills/code, memory/skills/life)
        for sub in list_subdirs(d):
            subdir = os.path.join(d, sub)
            for f in list_md_files(subdir):
                text = read_file(os.path.join(subdir, f))
                if text:
                    s = parse_skill(text, f)
                    s["file"] = sub + "/" + f
                    skills.append(s)
        # dedupe by name, keep first
        seen, uniq = set(), []
        for s in skills:
            if s["name"] not in seen:
                seen.add(s["name"])
                uniq.append(s)
        data[agent] = uniq
    return data


PROFILE_DIRS = {
    "web": "/opt/localagent/dsh-home/profiles/web",
    "sdk": "/opt/localagent/dsh-home/profiles/sdk",
}
# 官方核心包不在 profile 的 node_modules 里落盘（由 DSH 运行时自带），用内置说明兜底。
BUILTIN_PLUGIN_DESC = {
    "@deepseek-ai/dsh-base": "DSH 核心基础：会话、工具、模型调用等底层能力。",
    "@deepseek-ai/dsh-web-app": "DSH 网页界面：你在浏览器里看到的 DSH。",
    "@deepseek-ai/dsh-sdk-app": "DSH Agent 运行时：code / life / memory 三个管家跑在这里。",
}


def _read_json_via_sudo(path):
    txt = _sudo(["cat", path])
    if not txt:
        return {}
    try:
        return jsonmod.loads(txt)
    except Exception:  # noqa: BLE001
        return {}


def _plugin_pkg(name):
    """找一个插件的 package.json：先找各 profile 的 node_modules，再找本地插件目录。"""
    for prof in PROFILE_DIRS.values():
        p = _read_json_via_sudo(os.path.join(prof, "node_modules", name, "package.json"))
        if p:
            return p
    p = _read_json_via_sudo(os.path.join("/opt/localagent/dsh-plugins", name, "package.json"))
    return p or {}


# DSH 官方内置插件（官方「插件」设置页里的那些，不在 profile 的 bundles 中，
# 所以要单独列出，合并进插件库的「官方」板块；名字与说明取自官方插件页原文）。
# icon 是插件库里用的象形图标 key；icon_pkg 是该插件自带的官方 icon.svg 所在包
# （有 icon.svg 的用官方原图，没有的用客户端按官方风格重画的象形图标）。
# 注意：@deepseek-ai/* 核心包（dsh-base / dsh-web-app / dsh-sdk-app）是 DSH 框架
# 本体，不是用户面对的插件——用户要求删掉官方板块最上面那一块，这里不再列出。
BUILTIN_PLUGINS = [
    {"name": "子智能体", "description": "设置子智能体的递归层级、数量和模型。",
     "icon": "subagent", "icon_pkg": "", "source": "DSH 内置", "profiles": ["内置"], "version": ""},
    {"name": "网页搜索", "description": "设置 DeepSeek 的搜索提供方。",
     "icon": "search", "icon_pkg": "", "source": "DSH 内置", "profiles": ["内置"], "version": ""},
    {"name": "Agent 循环", "description": "控制 Agent 派发工具调用的方式。",
     "icon": "loop", "icon_pkg": "", "source": "DSH 内置", "profiles": ["内置"], "version": ""},
    {"name": "终端", "description": "限制每条命令最多能跑多久、最多输出多少内容。",
     "icon": "terminal", "icon_pkg": "dsh-experimental-terminal-bundle", "source": "DSH 内置", "profiles": ["内置"], "version": ""},
    {"name": "智能体团队", "description": "让与你对话的智能体把工作分给有名字的队友，在共享任务看板上跟踪进度，并汇总队友的结果向你汇报。",
     "icon": "team", "icon_pkg": "dsh-experimental-agent-team-profile", "source": "DSH 内置", "profiles": ["内置"], "version": ""},
    {"name": "语音输入", "description": "在本机使用 SenseVoice 转写录音，首次使用需安装依赖。",
     "icon": "mic", "icon_pkg": "dsh-experimental-voice-input-bundle", "source": "DSH 内置", "profiles": ["内置"], "version": ""},
    {"name": "自定义插件索引", "description": "在插件页添加“发现”标签页，从你添加的插件索引中浏览和安装插件。",
     "icon": "grid", "icon_pkg": "dsh-experimental-plugin-market-bundle", "source": "DSH 内置", "profiles": ["内置"], "version": ""},
    {"name": "自动授权审查", "description": "提供“自动审查”访问模式：每次工具调用前，由模型对照你的要求检查，获准的调用立即运行，被拒绝的调用等待你的决定。",
     "icon": "shield", "icon_pkg": "dsh-experimental-auto-review", "source": "DSH 内置", "profiles": ["内置"], "version": ""},
    {"name": "变更请求与工作树", "description": "在会话侧栏集中跟踪关联的 GitHub PR：查看检查状态、评审意见与代码差异，并把修改建议交给智能体继续处理。",
     "icon": "worktree", "icon_pkg": "dsh-experimental-tool-worktree", "source": "DSH 内置", "profiles": ["内置"], "version": ""},
]

DSH_PKG_BASE = "/opt/localagent/npm-global/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai"


def _read_icon_svg(pkg):
    """读一个 DSH 包自带的官方 icon.svg，返回 data URI（供客户端 <img> 用）。"""
    if not pkg:
        return ""
    txt = _sudo(["cat", os.path.join(DSH_PKG_BASE, pkg, "icon.svg")])
    if not txt or "<svg" not in txt:
        return ""
    import base64
    b64 = base64.b64encode(txt.encode("utf-8")).decode("ascii")
    return "data:image/svg+xml;base64," + b64


def _read_plugin_icon_svg(name):
    """找一个非官方插件自带的 icon.svg，返回 data URI（供客户端 <img> 用）。
    按顺序查 sdk/web 两个 profile 的 node_modules（根目录与 assets/ 下）
    以及 /opt/localagent/dsh-plugins；都找不到就返回空串，客户端走回退图标。"""
    import base64
    candidates = [
        "/opt/localagent/dsh-home/profiles/sdk/node_modules/%s/icon.svg" % name,
        "/opt/localagent/dsh-home/profiles/sdk/node_modules/%s/assets/icon.svg" % name,
        "/opt/localagent/dsh-home/profiles/web/node_modules/%s/icon.svg" % name,
        "/opt/localagent/dsh-home/profiles/web/node_modules/%s/assets/icon.svg" % name,
        "/opt/localagent/dsh-plugins/%s/icon.svg" % name,
    ]
    for path in candidates:
        txt = _sudo(["cat", path])
        if txt and "<svg" in txt:
            b64 = base64.b64encode(txt.encode("utf-8")).decode("ascii")
            return "data:image/svg+xml;base64," + b64
    return ""


def _nm_dirs(prof_dir):
    """一个 profile 的 node_modules 顶层目录（已装的包），供找已停用的插件用。"""
    out = _sudo(["ls", os.path.join(prof_dir, "node_modules")])
    return set(x.strip() for x in out.splitlines()
               if x.strip() and not x.strip().startswith("."))


def scan_plugins():
    """读 web + sdk 两个 profile 的 package.json，汇总插件，分官方 / 非官方。
    官方板块 = DSH 官方内置插件（上面 BUILTIN_PLUGINS），不可在此管理。
    非官方板块 = 后装的插件，带启用状态：
      enabled=True  = 在 web 的 bundles 里（桌面端已加载），或仅在 sdk 里（Agent 运行时已加载）。
      manageable=True = 能在插件库里开关/删除：web 的 bundles / 依赖 / node_modules 里有，
                        或 /opt/localagent/dsh-plugins/ 有源码目录。仅 sdk 里的 npm 包不可管
                        （改它会影响三个 Agent 的运行环境）。"""
    pkgs = {}
    for prof_name, prof_dir in PROFILE_DIRS.items():
        pkgs[prof_name] = _read_json_via_sudo(os.path.join(prof_dir, "package.json")) or {}
    web_pkg = pkgs.get("web", {})
    sdk_pkg = pkgs.get("sdk", {})
    web_bundles = set(((web_pkg.get("dsh") or {}).get("profile") or {}).get("bundles") or [])
    sdk_bundles = set(((sdk_pkg.get("dsh") or {}).get("profile") or {}).get("bundles") or [])
    web_deps = set((web_pkg.get("dependencies") or {}).keys())
    sdk_deps = set((sdk_pkg.get("dependencies") or {}).keys())
    web_nm = _nm_dirs(PROFILE_DIRS["web"])
    src_dirs = set(list_subdirs("/opt/localagent/dsh-plugins"))

    plugins = {}

    def _entry(name):
        return plugins.setdefault(name, {
            "name": name, "profiles": [], "spec": "",
            "version": "", "description": "", "source": "",
            "enabled": False, "manageable": False,
        })

    # web bundles：桌面端已启用，可管理。
    for name in sorted(web_bundles):
        if name.startswith("@deepseek-ai/"):
            continue
        e = _entry(name)
        e["enabled"] = True
        e["manageable"] = True
        if "web" not in e["profiles"]:
            e["profiles"].append("web")
        if not e["spec"]:
            e["spec"] = (web_pkg.get("dependencies") or {}).get(name, "")
    # sdk bundles（不在 web 里的）：Agent 运行时已启用，不可在此管理。
    for name in sorted(sdk_bundles):
        if name.startswith("@deepseek-ai/"):
            continue
        e = _entry(name)
        if "sdk" not in e["profiles"]:
            e["profiles"].append("sdk")
        if not e["manageable"]:
            e["enabled"] = True
        if not e["spec"]:
            e["spec"] = (sdk_pkg.get("dependencies") or {}).get(name, "")
    # web 依赖 / node_modules 里有、但不在 bundles 里：已停用，可管理。
    for name in sorted(web_deps | web_nm):
        if name.startswith("@deepseek-ai/") or name.startswith("."):
            continue
        e = _entry(name)
        e["manageable"] = True
        if "web" not in e["profiles"]:
            e["profiles"].append("web")
        if not e["spec"]:
            e["spec"] = (web_pkg.get("dependencies") or {}).get(name, "")
    # sdk 依赖里有、但不在 sdk bundles 里：Agent 侧已停用，只展示、不可管。
    for name in sorted(sdk_deps):
        if name.startswith("@deepseek-ai/"):
            continue
        e = _entry(name)
        if "sdk" not in e["profiles"]:
            e["profiles"].append("sdk")
        if not e["spec"]:
            e["spec"] = (sdk_pkg.get("dependencies") or {}).get(name, "")
    # /opt/localagent/dsh-plugins/ 有源码、但没装进任何 profile：未安装，可一键装上。
    for name in sorted(src_dirs):
        if name.startswith("@deepseek-ai/"):
            continue
        e = _entry(name)
        e["manageable"] = True
        if not e["spec"]:
            e["source"] = "本地文件"
    # 补版本 / 说明 / 来源 / 图标；同时去掉不是 DSH 插件的杂项
    #（node_modules 里偶尔有的普通依赖包）：只保留在 bundles/依赖里出现过的，
    # 或 package.json 里有 dsh 字段的。
    unofficial = []
    for name in sorted(plugins):
        entry = plugins[name]
        in_bundles = name in web_bundles or name in sdk_bundles
        in_deps = name in web_deps or name in sdk_deps
        info = _plugin_pkg(name)
        if not (in_bundles or in_deps or info.get("dsh")):
            continue
        spec = entry["spec"] or ""
        if spec.startswith("file:"):
            entry["source"] = "本地文件"
        elif spec.startswith("github:"):
            entry["source"] = "GitHub"
        elif spec:
            entry["source"] = "npm"
            entry["version"] = spec
        elif not entry["source"]:
            entry["source"] = "DSH 内置"
        if info.get("version"):
            entry["version"] = info["version"]
        if info.get("description"):
            entry["description"] = info["description"]
        elif name in BUILTIN_PLUGIN_DESC:
            entry["description"] = BUILTIN_PLUGIN_DESC[name]
        if not entry["profiles"]:
            entry["profiles"] = ["未安装"]
        # 非官方插件自带的 icon.svg（有就带上原图，没有就空串走客户端回退图标）。
        entry["icon_svg"] = _read_plugin_icon_svg(name)
        unofficial.append(entry)
    # 官方板块只放官方内置插件；有官方 icon.svg 的带上原图 data URI。
    official = []
    for b in BUILTIN_PLUGINS:
        entry = dict(b)
        entry["icon_svg"] = _read_icon_svg(b.get("icon_pkg", ""))
        entry["enabled"] = True
        entry["manageable"] = False
        official.append(entry)
    return {"official": official, "unofficial": unofficial,
            "total": len(official) + len(unofficial)}


# ---- 插件管理（启用 / 停用 / 删除），只针对 web profile ----
WEB_PKG = "/opt/localagent/dsh-home/profiles/web/package.json"
DSH_BIN = "/opt/localagent/bin/dsh-node24"
DSH_PATH = "/opt/localagent/npm-global/bin:/opt/localagent/node24/bin:/usr/local/bin:/usr/bin:/bin"


def _sudo_proc(args, timeout=120):
    """sudo -A <args>（以 root 跑），返回 (returncode, stdout, stderr)。"""
    try:
        r = subprocess.run(["sudo", "-A"] + args, capture_output=True, text=True,
                           timeout=timeout, env=ENV)
        return r.returncode, r.stdout, r.stderr
    except subprocess.TimeoutExpired:
        return -1, "", "timeout"


def _edit_web_bundles(action, name):
    """改 web profile package.json 里 dsh.profile.bundles：enable 加名、disable 删名。
    原地写回同一文件（属主与权限不变）。返回 (ok, changed, message)。"""
    code = (
        "import json, sys\n"
        "path, action, name = sys.argv[1], sys.argv[2], sys.argv[3]\n"
        "with open(path, encoding='utf-8') as f: pkg = json.load(f)\n"
        "prof = pkg.setdefault('dsh', {}).setdefault('profile', {})\n"
        "bundles = prof.setdefault('bundles', [])\n"
        "changed = False\n"
        "if action == 'enable' and name not in bundles: bundles.append(name); changed = True\n"
        "if action == 'disable' and name in bundles: bundles.remove(name); changed = True\n"
        "if changed:\n"
        "    with open(path, 'w', encoding='utf-8') as f:\n"
        "        json.dump(pkg, f, ensure_ascii=False, indent=2); f.write('\\n')\n"
        "print('changed' if changed else 'unchanged')\n"
    )
    rc, out, err = _sudo_proc(["python3", "-c", code, WEB_PKG, action, name], timeout=30)
    if rc != 0:
        return False, False, (err or out).strip()[-200:]
    return True, ("changed" in out), ""


def _dsh_plugin(args, timeout=180):
    """以 localagent 身份跑 dsh plugin --profile web <args>（pnpm 转发）。"""
    cmd = ["-u", "localagent", "env", "PATH=" + DSH_PATH, DSH_BIN,
           "plugin", "--profile", "web"] + args
    return _sudo_proc(cmd, timeout=timeout)


def plugin_action(body):
    """POST /api/plugins/action {action: enable|disable|remove, name}。
    只接受当前 scan 里 manageable 的插件名，@deepseek-ai/* 与带路径的名字一律拒绝。
    enable：已装进 web 的只改 bundles；只有源码目录的走 dsh plugin add file: 装上。
    disable：只把名字从 bundles 里拿掉，文件与依赖都保留，可再启用。
    remove：dsh plugin remove（从依赖 + bundles + node_modules 里移除），
            /opt/localagent/dsh-plugins/ 下的源码目录保留，可重新启用。"""
    try:
        req = jsonmod.loads(body)
    except Exception:  # noqa: BLE001
        return 400, {"ok": False, "error": "请求不是合法 JSON"}
    action = req.get("action", "")
    name = (req.get("name", "") or "").strip()
    if action not in ("enable", "disable", "remove"):
        return 400, {"ok": False, "error": "未知操作"}
    if (not name or "/" in name or "\\" in name or name.startswith(".")
            or name.startswith("@deepseek-ai/")):
        return 400, {"ok": False, "error": "插件名不合法"}
    data = scan_plugins()
    allowed = {p["name"] for p in data["unofficial"] if p.get("manageable")}
    if name not in allowed:
        return 400, {"ok": False, "error": "该插件不可在此管理"}
    if action == "disable":
        ok, changed, msg = _edit_web_bundles("disable", name)
        if not ok:
            return 500, {"ok": False, "error": "写配置失败：" + msg}
        return 200, {"ok": True, "action": action, "name": name, "changed": changed}
    if action == "enable":
        web_pkg = _read_json_via_sudo(WEB_PKG)
        if name in (web_pkg.get("dependencies") or {}):
            ok, changed, msg = _edit_web_bundles("enable", name)
            if not ok:
                return 500, {"ok": False, "error": "写配置失败：" + msg}
            return 200, {"ok": True, "action": action, "name": name, "changed": changed}
        src = "/opt/localagent/dsh-plugins/" + name
        if not _sudo(["ls", src]):
            return 400, {"ok": False, "error": "找不到该插件的安装来源"}
        rc, out, err = _dsh_plugin(["add", "file:" + src])
        if rc != 0:
            return 500, {"ok": False, "error": "安装失败：" + (err or out).strip()[-300:]}
        return 200, {"ok": True, "action": action, "name": name, "changed": True}
    if action == "remove":
        rc, out, err = _dsh_plugin(["remove", name])
        if rc != 0:
            return 500, {"ok": False, "error": "删除失败：" + (err or out).strip()[-300:]}
        return 200, {"ok": True, "action": action, "name": name, "changed": True}
    return 400, {"ok": False, "error": "未知操作"}


def esc(s):
    return htmlmod.escape(s or "")


def skill_card(s):
    trig = f"<p><b>触发：</b>{esc(s['trigger'])}</p>" if s["trigger"] else ""
    steps = ""
    if s["steps"]:
        steps = "<details><summary>步骤预览</summary><pre>" + esc(s["steps"]) + "</pre></details>"
    return (
        f"<div class='card'><h3>{esc(s['name'])}</h3>"
        f"<p class='meta'>{esc(s['file'])} · {s['chars']} 字</p>"
        f"{trig}{steps}</div>"
    )


def render(data):
    total = len({s["name"] for v in data.values() for s in v})
    nav = "".join(
        f"<a href='#{a}'>{AGENT_LABELS[a]} ({len(data[a])})</a>" for a in AGENT_ORDER
    )
    sections = ""
    for a in AGENT_ORDER:
        cards = "".join(skill_card(s) for s in data[a]) or "<p class='empty'>暂无 skill</p>"
        sections += f"<section id='{a}'><h2>{AGENT_LABELS[a]}</h2>{cards}</section>"
    return f"""<!DOCTYPE html>
<html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>DSH Skill 库</title>
<style>
body{{font-family:system-ui,-apple-system,"PingFang SC","Microsoft YaHei",sans-serif;max-width:860px;margin:0 auto;padding:24px 16px;color:#222;background:#fafafa}}
h1{{font-size:22px}}nav{{display:flex;gap:12px;flex-wrap:wrap;margin:12px 0 24px}}
nav a{{background:#fff;border:1px solid #ddd;border-radius:999px;padding:6px 14px;text-decoration:none;color:#2563eb}}
section{{margin-bottom:32px}}h2{{font-size:18px;border-bottom:2px solid #eee;padding-bottom:6px}}
.card{{background:#fff;border:1px solid #e5e5e5;border-radius:10px;padding:14px 16px;margin:10px 0}}
.card h3{{margin:0 0 4px;font-size:16px}}.meta{{color:#888;font-size:12px;margin:0 0 8px}}
.card p{{margin:6px 0;font-size:14px;line-height:1.6}}pre{{white-space:pre-wrap;font-size:13px;background:#f6f6f6;padding:10px;border-radius:6px;overflow:auto}}
details summary{{cursor:pointer;color:#2563eb;font-size:14px}}.empty{{color:#999}}
footer{{color:#999;font-size:12px;margin-top:24px}}
</style></head><body>
<h1>DSH Skill 库</h1>
<p>共 <b>{total}</b> 个不同 skill（实时读取 DSH 的 skill 目录）。点下面切换查看：</p>
<nav>{nav}</nav>
{sections}
<footer>来源：/opt/localagent/dsh-workspace/skills（全局）与 code / life / memory 各自的 skills 目录。新增 skill 后刷新本页即更新。</footer>
</body></html>"""


import json as jsonmod


class Handler(BaseHTTPRequestHandler):
    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "*")

    def do_OPTIONS(self):
        self.send_response(204)
        self._cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_POST(self):
        try:
            length = int(self.headers.get("Content-Length") or 0)
            body = self.rfile.read(length) if length > 0 else b""
            if self.path.startswith("/api/plugins/action"):
                status, payload = plugin_action(body)
                out = jsonmod.dumps(payload, ensure_ascii=False).encode("utf-8")
                self.send_response(status)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self._cors()
                self.send_header("Content-Length", str(len(out)))
                self.end_headers()
                self.wfile.write(out)
                return
            self.send_response(404)
            self._cors()
            self.send_header("Content-Length", "0")
            self.end_headers()
        except Exception as e:  # noqa: BLE001
            body = ("<h1>插件操作失败</h1><pre>" + esc(str(e)) + "</pre>").encode("utf-8")
            self.send_response(500)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self._cors()
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def do_GET(self):
        try:
            if self.path.startswith("/api/plugins"):
                body = jsonmod.dumps(scan_plugins(), ensure_ascii=False).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self._cors()
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                return
            data = scan()
            if self.path.startswith("/api/skills"):
                body = jsonmod.dumps(
                    {"agents": data, "total": len({s["name"] for v in data.values() for s in v})},
                    ensure_ascii=False).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
            else:
                body = render(data).encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
            self._cors()
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:  # noqa: BLE001
            body = ("<h1>读取 skill 失败</h1><pre>" + esc(str(e)) + "</pre>").encode("utf-8")
            self.send_response(500)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self._cors()
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)

    def log_message(self, fmt, *args):
        pass


if __name__ == "__main__":
    HTTPServer(("0.0.0.0", 8899), Handler).serve_forever()
