"""Run:  python server.py --mode http   (JARVIS bridge, 127.0.0.1 only)
        python server.py --mode mcp    (stdio MCP server for other clients; needs `pip install mcp`)"""
import argparse
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import policy
from tools import TOOLS

LOCK = threading.Lock()  # one phone action at a time


def run_tool(name: str, args: dict) -> str:
    if name not in TOOLS:
        raise ValueError(f"unknown tool {name}")
    with LOCK:
        return str(TOOLS[name](**(args or {})))


class H(BaseHTTPRequestHandler):
    def _send(self, code, body):
        data = (body if isinstance(body, str) else json.dumps(body)).encode()
        self.send_response(code); self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)

    def _authed(self):
        tok = os.environ.get("ANDROID_BRIDGE_TOKEN", "")
        return bool(tok) and self.headers.get("x-bridge-token") == tok

    def do_GET(self):
        if not self._authed(): return self._send(401, {"error": "bad token"})
        self._send(200, {"killed": policy.killed(), "apps": sorted(policy.allowlist())})

    def do_POST(self):
        if not self._authed(): return self._send(401, {"error": "bad token"})
        try:
            n = int(self.headers.get("content-length", 0)); body = json.loads(self.rfile.read(n) or b"{}")
            if self.path == "/kill": policy.kill(); return self._send(200, {"killed": True})
            if self.path == "/resume": policy.resume(); return self._send(200, {"killed": False})
            if self.path == "/tool": return self._send(200, run_tool(body.get("name", ""), body.get("args", {})))
            self._send(404, {"error": "not found"})
        except policy.Blocked as e: self._send(403, {"error": str(e)})
        except Exception as e: self._send(500, {"error": str(e)[:300]})

    def log_message(self, *a): pass


def main():
    ap = argparse.ArgumentParser(); ap.add_argument("--mode", choices=["http", "mcp"], default="http")
    ap.add_argument("--port", type=int, default=int(os.environ.get("ANDROID_BRIDGE_PORT", 8765)))
    a = ap.parse_args()
    if a.mode == "mcp":
        from mcp.server.fastmcp import FastMCP
        mcp = FastMCP("jarvis-android")
        # explicit wrappers keep the MCP schemas accurate
        @mcp.tool()
        def open_app(app: str) -> str: return run_tool("open_app", {"app": app})
        @mcp.tool()
        def tap(x: int | None = None, y: int | None = None, text: str | None = None) -> str: return run_tool("tap", {"x": x, "y": y, "text": text})
        @mcp.tool()
        def type_text(text: str) -> str: return run_tool("type_text", {"text": text})
        @mcp.tool()
        def swipe(direction: str) -> str: return run_tool("swipe", {"direction": direction})
        @mcp.tool()
        def read_screen() -> str: return run_tool("read_screen", {})
        @mcp.tool()
        def run_agent_task(task: str, max_steps: int | None = None) -> str: return run_tool("run_agent_task", {"task": task, "max_steps": max_steps})
        mcp.run()
        return
    if not os.environ.get("ANDROID_BRIDGE_TOKEN"):
        raise SystemExit("Set ANDROID_BRIDGE_TOKEN first (any long random string).")
    print(f"Android bridge on http://127.0.0.1:{a.port}  allowlist={sorted(policy.allowlist())}")
    ThreadingHTTPServer(("127.0.0.1", a.port), H).serve_forever()


if __name__ == "__main__":
    main()
