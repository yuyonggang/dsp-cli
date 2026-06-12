import { test } from "node:test";
import assert from "node:assert/strict";
import { extractSqlDependencies, extractFromRefs } from "./graph.js";

test("extractSqlDependencies finds quoted FROM and JOIN", () => {
  const sql = `SELECT * FROM "T1" LEFT JOIN "T2" ON ... INNER JOIN "T3" ON ...`;
  assert.deepEqual(extractSqlDependencies(sql).sort(), ["T1", "T2", "T3"]);
});

test("extractSqlDependencies returns [] for null/empty", () => {
  assert.deepEqual(extractSqlDependencies(null), []);
  assert.deepEqual(extractSqlDependencies(""), []);
});

test("extractFromRefs walks simple ref", () => {
  const from = { ref: ["MY_TABLE"] };
  assert.deepEqual(extractFromRefs(from), ["MY_TABLE"]);
});

test("extractFromRefs walks nested join args", () => {
  const from = {
    join: "left",
    args: [{ ref: ["A"] }, { ref: ["B"] }],
  };
  assert.deepEqual(extractFromRefs(from).sort(), ["A", "B"]);
});

test("extractFromRefs walks nested SELECT", () => {
  const from = { SELECT: { from: { ref: ["NESTED"] } } };
  assert.deepEqual(extractFromRefs(from), ["NESTED"]);
});
