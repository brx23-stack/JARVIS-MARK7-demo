import test from "node:test";
import assert from "node:assert/strict";
import { parseJson } from "../../lib/agents/parseJson.ts";

test("parses plain JSON", () => {
  assert.deepEqual(parseJson<{ a: number }>('{"a":1}'), { a: 1 });
});

test("strips ```json fences", () => {
  assert.deepEqual(parseJson('```json\n{"goal":"x","steps":[]}\n```'), { goal: "x", steps: [] });
});

test("strips bare ``` fences", () => {
  assert.deepEqual(parseJson('```\n{"a":2}\n```'), { a: 2 });
});

test("extracts JSON surrounded by chatter", () => {
  assert.deepEqual(parseJson('Sure! Here is the plan:\n{"a":3}\nHope that helps.'), { a: 3 });
});

test("handles arrays", () => {
  assert.deepEqual(parseJson("[1,2,3]"), [1, 2, 3]);
});

test("returns null for garbage, empty and truncated output", () => {
  assert.equal(parseJson("not json at all"), null);
  assert.equal(parseJson(""), null);
  assert.equal(parseJson('{"steps":[{"id":"s1"'), null);
});
