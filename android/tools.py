"""The six tools. Shared by the MCP server and the HTTP bridge."""
import json

import flows
import policy
from agent import run_agent
from device import Device, format_screen

_dev = Device()


def open_app(app: str) -> str:
    return f"opened {_dev.open_app(app)}"


def tap(x=None, y=None, text=None) -> str:
    if text:
        t = text.lower()
        for n in _dev.read_screen():
            if t in (n["text"] + " " + n["desc"]).lower():
                if policy.is_sensitive(n["text"] or n["desc"]):
                    raise policy.Blocked("Sensitive control; ask the user to tap it themselves.")
                _dev.tap(n["cx"], n["cy"]); return f"tapped '{n['text'] or n['desc']}'"
        raise ValueError(f"no element matching '{text}'")
    if x is None or y is None:
        raise ValueError("give x and y, or text")
    _dev.tap(x, y); return f"tapped {x},{y}"


def type_text(text: str) -> str:
    _dev.type_text(text); return "typed"


def swipe(direction: str) -> str:
    _dev.swipe_dir(direction); return f"swiped {direction}"


def read_screen() -> str:
    _dev.guard(strict=False)
    return format_screen(_dev.read_screen())


def run_agent_task(task: str, max_steps=None) -> str:
    policy.check_alive()
    done = flows.try_scripted(_dev, task)  # tier 1
    if done is not None:
        return json.dumps({"tier": 1, "status": "done", "result": done})
    res = run_agent(_dev, task, max_steps)  # tier 2
    res["tier"] = 2
    return json.dumps(res)


TOOLS = {"open_app": open_app, "tap": tap, "type_text": type_text, "swipe": swipe,
         "read_screen": read_screen, "run_agent_task": run_agent_task}
