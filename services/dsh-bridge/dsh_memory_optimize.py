#!/usr/bin/env python3
"""Weekly Memory Agent self-optimization (Phase 3).

Runs the Memory Agent (own DSH session 'memory-optimize', so it never
conflicts with the bridge's live 'memory' session) to:
  1. Review recent DSH session logs + workspace memory.
  2. Distill 1-3 reusable methods into skills.
  3. AUTONOMOUSLY create each skill and install it on the Code and/or Life
     agent (write the skill file to the shared skills dir AND to the target
     agent's workspace skills/ dir).
  4. Append one audit line per skill to ./memory/skill-audit.log
     (what, to whom, when). No /approve gate (explicitly authorized);
     the audit log is the record.
Runs weekly via a systemd timer. Can also be run manually.
"""
import logging
import os
import pathlib
import sys

HOME = "/opt/localagent"
ENV_FILE = os.path.join(HOME, "config", "agent.env")
DSH_HOME = os.path.join(HOME, "dsh-home")
DSH_WORKSPACE = os.path.join(HOME, "dsh-workspace")
MEMORY_DIR = os.path.join(DSH_WORKSPACE, "memory")
SKILLS_DIR = os.path.join(DSH_WORKSPACE, "skills")
LOG_FILE = os.path.join(HOME, "logs", "dsh-memory-optimize.log")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE, encoding="utf-8"),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger("dsh-memory-optimize")

OPTIMIZE_PROMPT = """You are the Memory Agent. This is your weekly self-optimization run.

1. Review the recent DSH session logs in {dsh_home}/sessions/ and the files in your working directory (./MEMORY.md, ./skill-audit.log).
2. Distill 1-3 reusable methods into skills (things that came up repeatedly, or a clearly better way to do a recurring task). If nothing is worth distilling, say so and stop.
3. For each new skill, write it as a Markdown file to {skills_dir}/<skill-name>.md AND copy it to the target agent's workspace skills dir (Code agent: {code_skills}/, Life agent: {life_skills}/). A skill file has: name, when to use it, steps, one example. Only install a skill on the agent(s) it actually helps (code, life, or both).
4. Append one line per skill to ./skill-audit.log in this exact format:
   <YYYY-MM-DD> | created skill <name> | installed on <code|life|both> | <one-line summary>
5. Reply with a short summary of what you created (or "no new skills this week").

Rules: do not modify agent system prompts, the bridge code, or any file outside the skills dirs and ./skill-audit.log. Only create skills.
"""


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


def main():
    env = load_env()
    key = env.get("DEEPSEEK_API_KEY", "")
    if not key:
        log.error("missing DEEPSEEK_API_KEY in agent.env")
        return 1
    for d in (MEMORY_DIR, SKILLS_DIR,
              os.path.join(DSH_WORKSPACE, "code", "skills"),
              os.path.join(DSH_WORKSPACE, "life", "skills")):
        os.makedirs(d, exist_ok=True)

    from deepseek_harness import DeepSeekHarness, DeepSeekHarnessConfig

    cfg = DeepSeekHarnessConfig(
        provider="deepseek-official",
        model="deepseek-v4-flash",
        cwd=MEMORY_DIR,
        dsh_home=DSH_HOME,
        dsh_bin="/opt/localagent/bin/dsh-node24",
        api_key=key,
        env={
            "DSH_TELEMETRY_DISABLED": "1",
            "DSH_TELEMETRY_MODE": "DISABLED",
        },
    )
    harness = DeepSeekHarness(cfg)
    log.info("starting DSH harness for memory optimization...")
    harness.start()
    try:
        sess = harness.resume_session("memory-optimize")
    except Exception:  # noqa: BLE001
        sess = harness.start_session("memory-optimize")
    try:
        sess.set_working_directory(MEMORY_DIR)
    except Exception as e:  # noqa: BLE001
        log.warning("set_working_directory failed: %s", e)
    prompt = OPTIMIZE_PROMPT.format(
        dsh_home=DSH_HOME,
        skills_dir=SKILLS_DIR,
        code_skills=os.path.join(DSH_WORKSPACE, "code", "skills"),
        life_skills=os.path.join(DSH_WORKSPACE, "life", "skills"),
    )
    log.info("running memory optimization...")
    result = sess.run(prompt)
    reply = (getattr(result, "final_response", "") or "").strip()
    log.info("optimization result: %s", reply[:500])
    print(reply)
    harness.close()
    # Sync staged skills into the target agents' workspaces.
    # (The DSH agent is sandboxed to MEMORY_DIR, so it stages new skills in
    # memory/skills/code/ and memory/skills/life/; this process, not sandboxed,
    # copies them into the real code/life/shared skills dirs.)
    import shutil
    def _sync(src_dir, dst_dir, label):
        src = pathlib.Path(src_dir)
        dst = pathlib.Path(dst_dir)
        if not src.is_dir():
            return 0
        dst.mkdir(parents=True, exist_ok=True)
        n = 0
        for f in sorted(src.glob("*.md")):
            target = dst / f.name
            if target.exists() and target.read_bytes() == f.read_bytes():
                continue
            shutil.copy2(f, target)
            log.info("installed skill %s -> %s (%s)", f.name, dst, label)
            n += 1
        return n
    synced = 0
    synced += _sync(os.path.join(MEMORY_DIR, "skills", "code"), os.path.join(DSH_WORKSPACE, "code", "skills"), "code")
    synced += _sync(os.path.join(MEMORY_DIR, "skills", "life"), os.path.join(DSH_WORKSPACE, "life", "skills"), "life")
    synced += _sync(os.path.join(MEMORY_DIR, "skills"), SKILLS_DIR, "shared")
    log.info("synced %d staged skill file(s) into agent workspaces", synced)
    log.info("memory optimization done")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
