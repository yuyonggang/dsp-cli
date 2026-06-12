import { test } from "node:test";
import assert from "node:assert/strict";
import { parseColumnDef, columnExistsIn, normalizeCdsType } from "./csn.js";

test("parseColumnDef parses NAME:TYPE:LEN:LABEL", () => {
  const c = parseColumnDef("FOO:cds.String:10:Foo Label");
  assert.equal(c.name, "FOO");
  assert.equal(c.cdsType, "cds.String");
  assert.equal(c.length, 10);
  assert.equal(c.label, "Foo Label");
});

test("parseColumnDef applies cds. prefix shorthand", () => {
  const c = parseColumnDef("X:String:5:X");
  assert.equal(c.cdsType, "cds.String");
});

test("parseColumnDef handles label with colons", () => {
  const c = parseColumnDef("X:cds.String:5:Time: Now");
  assert.equal(c.label, "Time: Now");
});

test("parseColumnDef handles missing label", () => {
  const c = parseColumnDef("X:cds.String:5");
  assert.equal(c.label, "X");
});

test("columnExistsIn finds existing column", () => {
  const csn = { definitions: { T: { elements: { FOO: { type: "cds.String" } } } } };
  assert.equal(columnExistsIn(csn, "T", "FOO"), true);
  assert.equal(columnExistsIn(csn, "T", "BAR"), false);
});

test("normalizeCdsType adds cds. prefix", () => {
  assert.equal(normalizeCdsType("String"), "cds.String");
  assert.equal(normalizeCdsType("cds.Integer"), "cds.Integer");
});
