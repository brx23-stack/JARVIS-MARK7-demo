"""Offline self-test with a fake phone (no adb, no network). Run: python selftest.py"""
import json, os, tempfile
os.environ["ANDROID_KILL_FILE"] = os.path.join(tempfile.mkdtemp(), "kill")
import policy, flows, agent
from device import parse_screen, format_screen

XML = '''<?xml version='1.0'?><hierarchy><node text="Search" content-desc="" resource-id="com.x:id/q" class="android.widget.EditText" clickable="true" focused="true" password="false" scrollable="false" bounds="[0,100][1080,200]"/>
<node text="Pay now" content-desc="" resource-id="" class="android.widget.Button" clickable="true" focused="false" password="false" scrollable="false" bounds="[0,300][540,400]"/>
<node text="" content-desc="" resource-id="" class="android.view.View" clickable="false" bounds="[0,0][1,1]"/></hierarchy>'''

class Fake:
    def __init__(s): s.log=[]; s.pkg="com.android.chrome"; s.n=0
    def guard(s, strict=True): policy.check_alive(); return s.pkg
    def read_screen(s): s.n+=1; return parse_screen(XML.replace("Search", f"Search{s.n if s.log else 0}"))
    def tap(s,x,y): s.log.append(("tap",x,y))
    def type_text(s,t): s.log.append(("type",t))
    def swipe_dir(s,d): s.log.append(("swipe",d))
    def back(s): s.log.append(("back",))
    def home(s): s.log.append(("home",))
    def open_app(s,n): s.log.append(("open",policy.resolve_app(n))); return policy.resolve_app(n)
    def start_intent(s,a): s.log.append(("intent",a))

nodes = parse_screen(XML); assert len(nodes)==2 and nodes[0]["editable"]; print(format_screen(nodes))
assert policy.resolve_app("Chrome")=="com.android.chrome"
try: policy.resolve_app("bank"); raise SystemExit("allowlist FAILED")
except policy.Blocked: pass
d=Fake(); assert flows.try_scripted(d,"open settings")=="opened com.android.settings"
assert "timer set for 300" in flows.try_scripted(d,"set a timer for 5 minutes"); assert flows.try_scripted(d,"write a poem") is None
# agent: scripted LLM -> tap sensitive control must stop for a human
seq=iter([json.dumps({"action":"type","text":"hi","expect":""}), json.dumps({"action":"tap","index":1})])
agent._llm=lambda m: next(seq); agent.time.sleep=lambda s: None
r=agent.run_agent(Fake(),"x",5); assert r["status"]=="needs_human", r
# step limit
agent._llm=lambda m: json.dumps({"action":"wait"}); r=agent.run_agent(Fake(),"x",3); assert r["status"] in("step_limit","stuck"), r
# kill switch
policy.kill(); r=agent.run_agent(Fake(),"x",3); assert r["status"]=="killed", r; policy.resume()
print("ALL OK")
