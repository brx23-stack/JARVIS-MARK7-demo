"""ADB device layer (stdlib only; works from a PC or Termux with android-tools)."""
import os
import re
import shlex
import subprocess
import time
import xml.etree.ElementTree as ET

import policy


class Device:
    def __init__(self, serial=None, adb=None):
        self.serial = serial or os.environ.get("ANDROID_SERIAL")
        self.adb = adb or os.environ.get("ADB_BIN", "adb")

    # ---- low level
    def _run(self, *args, timeout=20) -> str:
        cmd = [self.adb] + (["-s", self.serial] if self.serial else []) + list(args)
        try:
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        except FileNotFoundError:
            raise RuntimeError("adb not found. Install android-tools (PC: platform-tools; Termux: pkg install android-tools).")
        if r.returncode != 0:
            raise RuntimeError((r.stderr or r.stdout).strip()[:300] or "adb failed")
        return r.stdout

    def shell(self, cmd: str, timeout=20) -> str:
        return self._run("shell", cmd, timeout=timeout)

    def devices(self) -> list:
        out = self._run("devices")
        return [l.split()[0] for l in out.splitlines()[1:] if l.strip().endswith("device")]

    # ---- state
    def current_package(self) -> str:
        out = self.shell("dumpsys window | grep -E 'mCurrentFocus|mFocusedApp'")
        m = re.search(r"([a-zA-Z0-9_.]+)/[a-zA-Z0-9_.$]+", out)
        return m.group(1) if m else ""

    def screen_size(self):
        m = re.search(r"(\d+)x(\d+)", self.shell("wm size"))
        return (int(m.group(1)), int(m.group(2))) if m else (1080, 2400)

    def guard(self, strict=True) -> str:
        policy.check_alive()
        pkg = self.current_package()
        if not policy.foreground_ok(pkg, strict):
            raise policy.Blocked(f"Foreground app '{pkg}' is not on the allowlist. Use open_app first.")
        return pkg

    # ---- actions
    def open_app(self, name: str) -> str:
        policy.check_alive()
        pkg = policy.resolve_app(name)
        self.shell(f"monkey -p {shlex.quote(pkg)} -c android.intent.category.LAUNCHER 1")
        time.sleep(1.0)
        return pkg

    def tap(self, x: int, y: int):
        self.guard(strict=True)
        self.shell(f"input tap {int(x)} {int(y)}")

    def swipe(self, x1, y1, x2, y2, ms=300):
        self.guard(strict=False)
        self.shell(f"input swipe {int(x1)} {int(y1)} {int(x2)} {int(y2)} {int(ms)}")

    def swipe_dir(self, direction: str):
        w, h = self.screen_size()
        cx, cy = w // 2, h // 2
        d = {"up": (cx, int(h * .7), cx, int(h * .3)), "down": (cx, int(h * .3), cx, int(h * .7)),
             "left": (int(w * .8), cy, int(w * .2), cy), "right": (int(w * .2), cy, int(w * .8), cy)}.get(direction)
        if not d:
            raise ValueError("direction must be up/down/left/right")
        self.swipe(*d)

    def key(self, code: str):
        policy.check_alive()
        if not re.fullmatch(r"KEYCODE_[A-Z_]+|\d+", code):
            raise ValueError("bad keycode")
        self.shell(f"input keyevent {code}")

    def back(self): self.key("KEYCODE_BACK")
    def home(self): self.key("KEYCODE_HOME")

    def type_text(self, text: str):
        self.guard(strict=True)
        if any(n.get("password") for n in self.read_screen() if n.get("focused")):
            raise policy.Blocked("Focused field is a password field; refusing to type.")
        if not text.isascii():
            raise ValueError("adb input only supports ASCII text")
        self.shell("input text " + shlex.quote(text.replace(" ", "%s")))

    def start_intent(self, args: str):
        policy.check_alive()
        self.shell("am start " + args)

    # ---- accessibility tree
    def dump_xml(self) -> str:
        self.shell("uiautomator dump /sdcard/jarvis_ui.xml", timeout=25)
        return self.shell("cat /sdcard/jarvis_ui.xml")

    def read_screen(self) -> list:
        return parse_screen(self.dump_xml())


def parse_screen(xml: str) -> list:
    start = xml.find("<?xml")
    root = ET.fromstring(xml[start:] if start >= 0 else xml)
    out = []
    for n in root.iter("node"):
        text, desc, rid = n.get("text", ""), n.get("content-desc", ""), n.get("resource-id", "")
        clickable, editable = n.get("clickable") == "true", n.get("class", "").endswith("EditText")
        if not (text or desc or clickable or editable):
            continue
        m = re.match(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", n.get("bounds", ""))
        if not m:
            continue
        l, t, r, b = map(int, m.groups())
        out.append({"i": len(out), "text": text, "desc": desc, "id": rid.split("/")[-1], "cx": (l + r) // 2, "cy": (t + b) // 2,
                    "clickable": clickable, "editable": editable, "scrollable": n.get("scrollable") == "true",
                    "password": n.get("password") == "true", "focused": n.get("focused") == "true"})
    return out


def format_screen(nodes: list, limit=60) -> str:
    lines = []
    for n in nodes[:limit]:
        label = n["text"] or n["desc"] or n["id"] or "?"
        flags = "".join(f for f, on in (("C", n["clickable"]), ("E", n["editable"]), ("S", n["scrollable"])) if on)
        lines.append(f"[{n['i']}] {label[:60]} ({n['cx']},{n['cy']}) {flags}")
    return "\n".join(lines) or "(empty screen)"
