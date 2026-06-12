import { test } from "node:test";
import assert from "node:assert/strict";
import { topoOrder, classifyEdge } from "./cascade.js";

test("topoOrder sorts by depth ascending", () => {
  const items = [
    { name: "C", depth: 2 },
    { name: "A", depth: 0 },
    { name: "B", depth: 1 },
  ];
  const ordered = topoOrder(items);
  assert.deepEqual(ordered.map(i => i.name), ["A", "B", "C"]);
});

test("topoOrder dedupes by name keeping shallowest depth", () => {
  const items = [
    { name: "A", depth: 0 },
    { name: "B", depth: 1 },
    { name: "B", depth: 2 },
  ];
  const ordered = topoOrder(items);
  assert.equal(ordered.length, 2);
  assert.equal(ordered.find(i => i.name === "B").depth, 1);
});

test("classifyEdge returns skip for association", () => {
  assert.equal(classifyEdge("association"), "skip");
  assert.equal(classifyEdge("direct"), "process");
  assert.equal(classifyEdge("join"), "process");
  assert.equal(classifyEdge("sql"), "warn");
});
