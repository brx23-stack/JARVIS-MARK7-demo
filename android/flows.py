"""Tier 1: fast scripted flows. Return a result string, or None if the task isn't a known flow."""
import re
from urllib.parse import quote

import policy


def try_scripted(dev, task: str):
    t = task.strip().rstrip(".!").lower()
    m = re.match(r"^(?:open|launch|start)\s+(?:the\s+)?(.+?)(?:\s+app)?$", t)
    if m:
        return f"opened {dev.open_app(m.group(1))}"
    if t in ("go home", "home"):
        dev.home(); return "went home"
    if t in ("go back", "back"):
        dev.back(); return "went back"
    m = re.match(r"^(?:search|google)\s+(?:for\s+)?(.+)$", t)
    if m:
        chrome = policy.resolve_app("chrome")
        dev.start_intent(f"-a android.intent.action.VIEW -d {quote('https://www.google.com/search?q=' + quote(m.group(1)), safe=':/?=%&')} -p {chrome}")
        return f"searched for '{m.group(1)}' in Chrome"
    m = re.match(r"^set (?:a )?timer (?:for )?(\d+)\s*(second|sec|minute|min|hour|hr)s?$", t)
    if m:
        policy.resolve_app("clock")
        n = int(m.group(1)); unit = m.group(2)
        secs = n * (3600 if unit in ("hour", "hr") else 60 if unit.startswith("min") else 1)
        dev.start_intent(f"-a android.intent.action.SET_TIMER --ei android.intent.extra.alarm.LENGTH {secs} --ez android.intent.extra.alarm.SKIP_UI true")
        return f"timer set for {secs} seconds"
    return None
