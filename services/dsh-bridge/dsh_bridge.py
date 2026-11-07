#!/usr/bin/env python3
"""DSH control layer (总控层) v2.1: Telegram Bot API <-> DSH Python SDK.

Phase 2: 3 specialized Agents (memory / code / life) + general fallback,
all on one DSH runtime (persistent sessions). Intent: rules first
(/coder /life /memory); free text classified once with DeepSeek Flash
(cheap direct API call). Cross-Agent work is relayed by this layer.

Note: DSH SDK `run` only accepts a STRING input (a list of message dicts
returns finish=error). So the agent persona is prepended to the FIRST
message of each session as text, and each session gets its own working
directory via Session.set_working_directory.
"""
import json
import logging
import os
import sys
import time
import urllib.error
import urllib.request
from logging.handlers import RotatingFileHandler

HOME = "/opt/localagent"
ENV_FILE = os.path.join(HOME, "config", "agent.env")
DSH_HOME = os.path.join(HOME, "dsh-home")
DSH_WORKSPACE = os.path.join(HOME, "dsh-workspace")
LOG_FILE = os.path.join(HOME, "logs", "dsh-bridge.log")
BASELINE_FILE = os.path.join(HOME, "logs", "dsh-baseline.jsonl")
OFFSET_FILE = os.path.join(HOME, "data", "dsh-bridge-offset.txt")
ALLOWED_USER_ID = 8692341924
POLL_TIMEOUT = 30
MAX_MSG = 4000  # Telegram cap is 4096; keep a margin

GROK_STYLE = (
    "Answer concisely in the user's language (Chinese by default). "
    "Be direct, practical, and a little playful. Don't be verbose."
)

# Hard cost guard for sub-agents (also enforced by the bridge's structure):
# at most 3 sub-agents per task, at most 2 levels deep, small tasks done directly.
SUBAGENT_CAPS = (
    "You may spawn sub-agents for parallel work, but keep it bounded: "
    "at most 3 sub-agents per task, at most 2 levels deep, and do small tasks yourself."
)

# agent_name -> (session_id, persona, workspace dir)
AGENTS = {
    "memory": (
        "memory",
        "You are the Memory Agent. You manage the user's long-term memory, "
        "stored in ./MEMORY.md (your working directory). You recall past context, "
        "organize notes, and distill reusable methods into skills. You AUTONOMOUSLY "
        "create skills and install them on the Code and Life agents when you discover "
        "a reusable method (write the skill file, then note it in ./skill-audit.log "
        "with what, to whom, and when). You are precise and organized. " + GROK_STYLE
        + " " + SUBAGENT_CAPS,
        os.path.join(DSH_WORKSPACE, "memory"),
    ),
    "code": (
        "code",
        "You are the Code Agent. You write, review, debug, and refactor code in "
        "your working directory. You are a senior engineer: clean, correct code, "
        "explain your changes briefly, test when possible. " + GROK_STYLE
        + " " + SUBAGENT_CAPS,
        os.path.join(DSH_WORKSPACE, "code"),
    ),
    "life": (
        "life",
        "You are the Life Agent. You handle the user's daily life and trivial tasks: "
        "schedules, reminders, lookups, summaries, small errands. You are efficient, "
        "friendly, and practical. Keep notes in your working directory when useful. "
        + GROK_STYLE + " " + SUBAGENT_CAPS,
        os.path.join(DSH_WORKSPACE, "life"),
    ),
    "general": (
        "general",
        "You are a helpful, witty, fast general assistant (Grok-style). "
        "Handle anything the user asks. " + GROK_STYLE,
        DSH_WORKSPACE,
    ),
}

CLASSIFIER_SYSTEM = (
    "You are an intent classifier. Given the user's message, reply with a "
    "comma-separated list of agents, in execution order, or a single agent.\n"
    "- memory: remember/recall something, organize notes, manage knowledge or skills.\n"
    "- code: write, review, debug, or discuss code, software, or a project.\n"
    "- life: daily life, schedules, reminders, lookups, or trivial tasks.\n"
    "- general: anything else, greetings, small talk.\n"
    "If the task needs two agents in sequence (e.g. check code changes AND note "
    "them down), list both in order, e.g. 'code,memory'.\n"
    "Reply with ONLY the comma-separated list, no other words."
)


def setup_logging():
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)
    handler = RotatingFileHandler(
        LOG_FILE, maxBytes=5 * 1024 * 1024, backupCount=3, encoding="utf-8"
    )
    handler.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
    root = logging.getLogger()
    root.setLevel(logging.INFO)
    root.addHandler(handler)
    root.addHandler(logging.StreamHandler(sys.stdout))


log = logging.getLogger("dsh-bridge")


def load_env():
    env = {}
    if os.path.exists(ENV_FILE):
        with open(ENV_FILE, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                env[k.strip()] = v.strip()
    return env


class Telegram:
    def __init__(self, token):
        self.base = "https://api.telegram.org/bot" + token + "/"

    def _post(self, method, payload, timeout=40):
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            self.base + method,
            data=data,
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))

    def get_updates(self, offset, timeout=POLL_TIMEOUT):
        return self._post(
            "getUpdates",
            {"offset": offset, "timeout": timeout, "allowed_updates": ["message"]},
            timeout=timeout + 10,
        )

    def send_message(self, chat_id, text):
        for i in range(0, len(text), MAX_MSG):
            chunk = text[i : i + MAX_MSG]
            self._post("sendMessage", {"chat_id": chat_id, "text": chunk})


def classify_with_flash(text, api_key):
    """One cheap DeepSeek call to pick the agent chain (list, in order).
    Defaults to ['general']."""
    try:
        body = {
            "model": "deepseek-chat",
            "messages": [
                {"role": "system", "content": CLASSIFIER_SYSTEM},
                {"role": "user", "content": text},
            ],
            "temperature": 0,
            "max_tokens": 20,
        }
        data = json.dumps(body).encode("utf-8")
        req = urllib.request.Request(
            "https://api.deepseek.com/v1/chat/completions",
            data=data,
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer " + api_key,
            },
        )
        with urllib.request.urlopen(req, timeout=15) as resp:
            out = json.loads(resp.read().decode("utf-8"))
        ans = out["choices"][0]["message"]["content"].strip().lower()
        chain = []
        for part in ans.replace(" ", "").split(","):
            if part in ("memory", "code", "life", "general") and part not in chain:
                chain.append(part)
        if chain:
            return chain
    except Exception as e:  # noqa: BLE001
        log.warning("flash classification failed (%s); defaulting to general", e)
    return ["general"]


def classify_intent(text, api_key):
    """Rules first, then Flash. Returns a list of agents (chain, in order)."""
    t = (text or "").strip()
    low = t.lower()
    if t.startswith("/coder") or low.startswith("写代码") or low.startswith("帮我写"):
        return ["code"]
    if t.startswith("/life"):
        return ["life"]
    if t.startswith("/memory"):
        return ["memory"]
    return classify_with_flash(t, api_key)


def main():
    setup_logging()
    env = load_env()
    token = env.get("TELEGRAM_BOT_TOKEN", "")
    key = env.get("DEEPSEEK_API_KEY", "")
    if not token or not key:
        log.error("missing TELEGRAM_BOT_TOKEN or DEEPSEEK_API_KEY in agent.env")
        return 1
    tg = Telegram(token)

    from deepseek_harness import DeepSeekHarness, DeepSeekHarnessConfig

    cfg = DeepSeekHarnessConfig(
        provider="deepseek-official",
        model="deepseek-v4-flash",
        cwd=DSH_WORKSPACE,
        dsh_home=DSH_HOME,
        dsh_bin="/opt/localagent/bin/dsh-node24",
        api_key=key,
        env={
            "DSH_TELEMETRY_DISABLED": "1",
            "DSH_TELEMETRY_MODE": "DISABLED",
        },
    )
    harness = DeepSeekHarness(cfg)
    log.info("starting DSH harness...")
    harness.start()
    log.info("DSH harness started")

    # Per-agent Session objects (created lazily, each with its own workdir).
    sessions = {}

    def get_session(agent):
        if agent in sessions:
            return sessions[agent]
        session_id, persona, workdir = AGENTS[agent]
        # Resume first (session may persist from a previous bridge run);
        # only start a fresh one when resume reports "not found".
        resumed = False
        try:
            sess = harness.resume_session(session_id)
            resumed = True
            log.info("resumed session %s", session_id)
        except Exception:  # noqa: BLE001
            sess = harness.start_session(session_id)
            log.info("started new session %s", session_id)
        try:
            sess.set_working_directory(workdir)
        except Exception as e:  # noqa: BLE001
            log.warning("set_working_directory failed for %s: %s", agent, e)
        # If resumed, the persona is already in the session history; don't resend.
        sessions[agent] = (sess, persona, resumed)
        return sessions[agent]

    offset = 0
    if os.path.exists(OFFSET_FILE):
        try:
            offset = int(open(OFFSET_FILE).read().strip() or "0")
        except ValueError:
            offset = 0

    try:
        tg.send_message(
            ALLOWED_USER_ID,
            "DSH 控制层已升级到 Phase 2：3 个专职 Agent（记忆 / 代码 / 生活）已就绪。"
            "直接发消息即可，总控层会自动分发；/coder、/life、/memory 可指定 Agent；/status 看状态。",
        )
    except Exception as e:  # noqa: BLE001
        log.warning("startup notice failed: %s", e)

    log.info("bridge polling, offset=%s", offset)
    log.info("baseline logging to %s", BASELINE_FILE)
    fail_streak = 0
    while True:
        try:
            data = tg.get_updates(offset)
        except Exception as e:  # noqa: BLE001
            fail_streak += 1
            log.warning("getUpdates failed (%d/10): %s", fail_streak, e)
            if fail_streak >= 10:
                log.error("getUpdates failed 10x in a row, exiting for clean restart")
                raise SystemExit(1)
            time.sleep(5)
            continue
        if not data.get("ok"):
            fail_streak += 1
            log.warning("getUpdates not ok (%d/10): %s", fail_streak, data)
            if fail_streak >= 10:
                log.error("getUpdates not ok 10x in a row, exiting for clean restart")
                raise SystemExit(1)
            time.sleep(5)
            continue
        fail_streak = 0
        for upd in data.get("result", []):
            offset = upd["update_id"] + 1
            try:
                with open(OFFSET_FILE, "w") as f:
                    f.write(str(offset))
            except OSError:
                pass
            msg = upd.get("message") or {}
            frm = msg.get("from") or {}
            if frm.get("id") != ALLOWED_USER_ID:
                continue
            chat_id = msg.get("chat", {}).get("id", ALLOWED_USER_ID)
            text = (msg.get("text") or "").strip()
            if not text:
                continue
            log.info("msg from %s: %s", frm.get("id"), text[:120])
            if text in ("/start", "/help"):
                tg.send_message(
                    chat_id,
                    "DSH 控制层（Phase 2：记忆 / 代码 / 生活 三个专职 Agent）。"
                    "直接发消息，总控层自动分发；/coder、/life、/memory 指定 Agent；/status 看状态。",
                )
                continue
            if text == "/status":
                tg.send_message(
                    chat_id,
                    "DSH 控制层运行中。Agent：memory、code、life、general（各一个持久会话）。Phase 2。",
                )
                continue
            chain = classify_intent(text, key)
            user_input = text
            for cmd in ("/coder", "/life", "/memory"):
                if user_input.startswith(cmd):
                    user_input = user_input[len(cmd) :].strip() or "你好"
                    break
            log.info("dispatch chain -> %s", chain)
            round_start = time.perf_counter()
            round_steps = []
            try:
                # Execute the chain in order; each agent's output becomes
                # context for the next (control-layer relay).
                context = ""
                reply = ""
                for agent in chain:
                    session_id, _persona, _w = AGENTS[agent]
                    sess, persona, persona_sent = get_session(agent)
                    if not persona_sent:
                        inp = persona + "\n\n---\n\n"
                        if context:
                            inp += "Context from previous agent:\n" + context + "\n\n"
                        inp += user_input
                        sessions[agent] = (sess, persona, True)
                    else:
                        inp = user_input
                        if context:
                            inp = (
                                "Context from previous agent:\n"
                                + context
                                + "\n\nYour part of the user request:\n"
                                + user_input
                            )
                    step_start = time.perf_counter()
                    result = sess.run(inp)
                    reply = (getattr(result, "final_response", "") or "").strip()
                    if not reply:
                        reply = "（DSH 返回了空结果，请再试一次）"
                    context = reply
                    step_lat = time.perf_counter() - step_start
                    round_steps.append({"agent": agent, "latency_sec": round(step_lat, 2), "input_chars": len(inp), "output_chars": len(reply)})
                    log.info("chain step %s done (%d chars, %.1fs)", agent, len(reply), step_lat)
                tg.send_message(chat_id, reply)
                log.info("replied via chain %s (%d chars)", chain, len(reply))
                try:
                    rec = {
                        "ts": time.strftime("%Y-%m-%dT%H:%M:%S", time.localtime()),
                        "chain": list(chain),
                        "steps": round_steps,
                        "total_latency_sec": round(time.perf_counter() - round_start, 2),
                        "total_input_chars": sum(s["input_chars"] for s in round_steps),
                        "total_output_chars": sum(s["output_chars"] for s in round_steps),
                        "reply_chars": len(reply),
                    }
                    with open(BASELINE_FILE, "a", encoding="utf-8") as bf:
                        bf.write(json.dumps(rec, ensure_ascii=False) + "\n")
                except Exception:  # noqa: BLE001 - baseline logging must never break replies
                    pass
            except Exception as e:  # noqa: BLE001
                log.exception("DSH run failed")
                try:
                    tg.send_message(chat_id, "处理失败：%s" % e)
                except Exception:  # noqa: BLE001
                    pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
