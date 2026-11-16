import test from "node:test";
import assert from "node:assert/strict";
import { decideApproval, enqueueApproval, gateToolCall, pendingApprovals, recentApprovals } from "../../lib/approvals/queue.ts";

const isPending = (id: string) => pendingApprovals().some((p) => p.id === id);
const statusOf = (id: string) => recentApprovals(60).find((r) => r.id === id)?.status;

test("enqueueApproval queues without running", () => {
  let ran = false;
  const id = enqueueApproval("open_app", "Open app", "{}", async () => { ran = true; return "ok"; });
  assert.equal(ran, false);
  assert.equal(isPending(id), true);
});

test("approve runs the action once and records the result", async () => {
  let runs = 0;
  const id = enqueueApproval("t", "T", "{}", async () => { runs++; return "done!"; });
  assert.equal(await decideApproval(id, true), "approved");
  assert.equal(runs, 1);
  assert.equal(isPending(id), false);
  assert.equal(recentApprovals(60).find((r) => r.id === id)?.result, "done!");
  await assert.rejects(() => decideApproval(id, true), /Already approved/);
  assert.equal(runs, 1);
});

test("reject never runs the action", async () => {
  let ran = false;
  const id = enqueueApproval("t", "T", "{}", async () => { ran = true; return "x"; });
  assert.equal(await decideApproval(id, false), "rejected");
  assert.equal(ran, false);
  assert.equal(statusOf(id), "rejected");
  await assert.rejects(() => decideApproval(id, true), /Already rejected/);
});

test("a failing action is captured, not thrown", async () => {
  const id = enqueueApproval("t", "T", "{}", async () => { throw new Error("boom"); });
  assert.equal(await decideApproval(id, true), "approved");
  assert.match(recentApprovals(60).find((r) => r.id === id)?.result ?? "", /Error: boom/);
});

test("unknown id is rejected with a clear error", async () => {
  await assert.rejects(() => decideApproval("ap-nope", true), /not found/);
});

test("pending approvals expire after the TTL and can no longer run", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_700_000_000_000 });
  let ran = false;
  const id = enqueueApproval("t", "T", "{}", async () => { ran = true; return "x"; });
  assert.equal(isPending(id), true);
  t.mock.timers.tick(31 * 60_000); // default TTL is 30 min
  assert.equal(isPending(id), false);
  await assert.rejects(() => decideApproval(id, true), /Already expired/);
  assert.equal(ran, false);
});

test("gateToolCall runs unlisted tools now and queues listed ones", async () => {
  process.env.JARVIS_APPROVAL_TOOLS = "danger_tool";
  let safe = 0, danger = 0;
  assert.equal(await gateToolCall("safe_tool", "{}", async () => { safe++; return "ran"; }), "ran");
  const msg = await gateToolCall("danger_tool", "{}", async () => { danger++; return "ran"; });
  assert.match(msg, /Not executed yet/);
  assert.equal(safe, 1);
  assert.equal(danger, 0);
  delete process.env.JARVIS_APPROVAL_TOOLS;
});
