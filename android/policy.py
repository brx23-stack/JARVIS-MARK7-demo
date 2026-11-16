"""Safety policy: app allowlist, kill switch, sensitive-action words."""
import os
from pathlib import Path

DEFAULT_APPS = {
    "settings": "com.android.settings",
    "chrome": "com.android.chrome",
    "youtube": "com.google.android.youtube",
    "maps": "com.google.android.apps.maps",
    "clock": "com.google.android.deskclock",
    "calculator": "com.google.android.calculator",
}
# Launcher/system UI: swipe/back/home allowed here, but tap/type are not.
SYSTEM_PACKAGES = ("com.android.systemui", "com.google.android.apps.nexuslauncher", "com.android.launcher3",
                   "com.sec.android.app.launcher", "com.miui.home")
SENSITIVE = ("pay", "purchase", "buy now", "place order", "send money", "transfer", "delete account",
             "factory reset", "uninstall", "erase", "confirm order", "subscribe")


class Blocked(Exception):
    pass


def kill_file() -> Path:
    return Path(os.environ.get("ANDROID_KILL_FILE", str(Path.home() / ".jarvis_android_kill")))


def killed() -> bool:
    return kill_file().exists()


def kill() -> None:
    kill_file().write_text("killed")


def resume() -> None:
    kill_file().unlink(missing_ok=True)


def check_alive() -> None:
    if killed():
        raise Blocked("Kill switch is active. Call /resume to re-enable.")


def allowlist() -> dict:
    """ANDROID_APP_ALLOWLIST='chrome=com.android.chrome,notes=com.foo.notes' replaces the defaults."""
    raw = os.environ.get("ANDROID_APP_ALLOWLIST", "").strip()
    if not raw:
        return dict(DEFAULT_APPS)
    out = {}
    for part in raw.split(","):
        if "=" in part:
            k, v = part.split("=", 1)
            out[k.strip().lower()] = v.strip()
    return out


def resolve_app(name: str) -> str:
    n = (name or "").strip().lower()
    apps = allowlist()
    if n in apps:
        return apps[n]
    if n in apps.values():
        return n
    raise Blocked(f"App '{name}' is not on the allowlist ({', '.join(sorted(apps))}).")


def foreground_ok(pkg: str, strict: bool) -> bool:
    if pkg in allowlist().values():
        return True
    return (not strict) and pkg in SYSTEM_PACKAGES


def is_sensitive(label: str) -> bool:
    l = (label or "").lower()
    return any(w in l for w in SENSITIVE)
