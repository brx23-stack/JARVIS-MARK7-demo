"""Tier 2: autonomous fallback agent. Reads the accessibility tree, acts, verifies each step, gives up at the step limit."""
import hashlib
import json
import os
import time
import urllib.request

import policy
from device import format_screen

SYSTEM = """You control an Android phone through its accessibility tree to complete the user's task.
Each turn you see numbered screen elements: [index] label (x,y) flags (C=clickable E=editable S=scrollable).
Reply with ONE JSON object only:
{"thought": "short", "action": "tap|type|swipe|back|home|open_app|wait|done|fail",
 "index": <element number for tap>, "text": "<for type>", "direction": "up|down|left|right", "app": "<name>",
 "expect": "<short text you expect to see after the action, or empty>", "result": "<final answer when done/fail>"}
Rules: one action per turn. Never enter passwords or payment details. If unsure or blocked, use fail."""


def _llm(messages) -> str:
    key = os.environ.get("ANDROID_AGENT_API_KEY") or os.environ.get("GROQ_API_KEY")
    if not key:
        raise RuntimeError("no_llm_key: set ANDROID_AGENT_API_KEY (or GROQ_API_KEY)")
    url = os.environ.get("ANDROID_AGENT_LLM_URL", "https://api.groq.com/openai/v1/chat/completions")
    body = {"model": os.environ.get("ANDROID_AGENT_MODEL", "llama-3.3-70b-versatile"), "messages": messages,
            "temperature": 0.1, "max_tokens": 300, "response_format": {"type": "json_object"}}
    req = urllib.request.Request(url, json.dumps(body).encode(), {"Content-Type": "application/json", "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=40) as r:
        return json.loads(r.read())["choices"][0]["message"]["content"]


def _parse(s: str) -> dict:
    try:
        return json.loads(s)
    except Exception:
        a, b = s.find("{"), s.rfind("}")
        return json.loads(s[a:b + 1])


def _sig(nodes) -> str:
    return hashlib.md5("|".join(f"{n['text']}{n['desc']}{n['id']}" for n in nodes).encode()).hexdigest()


def run_agent(dev, task: str, max_steps=None) -> dict:
    cap = int(max_steps or os.environ.get("ANDROID_AGENT_MAX_STEPS", 12))
    cap = max(1, min(cap, 25))
    trace, history, bad = [], [], 0
    nodes = []
    for step in range(1, cap + 1):
        if policy.killed():
            return {"status": "killed", "steps": step - 1, "trace": trace}
        try:
            dev.guard(strict=False)
            nodes = dev.read_screen()
        except policy.Blocked as e:
            return {"status": "blocked", "steps": step - 1, "detail": str(e), "trace": trace}
        before = _sig(nodes)
        user = f"TASK: {task}\nSTEP {step}/{cap}\nRECENT:\n" + "\n".join(history[-5:]) + "\nSCREEN:\n" + format_screen(nodes)
        try:
            act = _parse(_llm([{"role": "system", "content": SYSTEM}, {"role": "user", "content": user}]))
        except Exception as e:
            return {"status": "llm_error", "steps": step - 1, "detail": str(e)[:200], "trace": trace}
        a = str(act.get("action", "")).lower()
        trace.append({"step": step, "action": a, "thought": act.get("thought", "")[:120]})
        if a == "done":
            return {"status": "done", "steps": step, "result": act.get("result", ""), "trace": trace}
        if a == "fail":
            return {"status": "failed", "steps": step, "result": act.get("result", ""), "trace": trace}
        try:
            if a == "tap":
                n = nodes[int(act["index"])]
                if policy.is_sensitive(n["text"] or n["desc"]):
                    return {"status": "needs_human", "steps": step, "detail": f"Sensitive control: {n['text'] or n['desc']}", "trace": trace}
                dev.tap(n["cx"], n["cy"])
            elif a == "type":
                dev.type_text(str(act.get("text", "")))
            elif a == "swipe":
                dev.swipe_dir(str(act.get("direction", "up")))
            elif a == "back":
                dev.back()
            elif a == "home":
                dev.home()
            elif a == "open_app":
                dev.open_app(str(act.get("app", "")))
            elif a != "wait":
                history.append(f"step {step}: unknown action '{a}'"); bad += 1
        except (policy.Blocked, ValueError, IndexError, KeyError, RuntimeError) as e:
            history.append(f"step {step}: {a} ERROR {e}"); bad += 1
            if isinstance(e, policy.Blocked):
                return {"status": "blocked", "steps": step, "detail": str(e), "trace": trace}
            if bad >= 3:
                return {"status": "stuck", "steps": step, "trace": trace}
            continue
        time.sleep(0.9)
        try:
            after_nodes = dev.read_screen()
        except Exception:
            after_nodes = nodes
        changed = _sig(after_nodes) != before
        expect = str(act.get("expect", "")).lower().strip()
        found = (not expect) or any(expect in (n["text"] + " " + n["desc"]).lower() for n in after_nodes)
        ok = (changed or a == "wait") and found
        history.append(f"step {step}: {a} -> {'VERIFIED' if ok else 'UNVERIFIED (screen ' + ('changed' if changed else 'unchanged') + (', expected text missing' if not found else '') + ')'}")
        bad = 0 if ok else bad + 1
        if bad >= 3:
            return {"status": "stuck", "steps": step, "trace": trace}
    return {"status": "step_limit", "steps": cap, "trace": trace}
