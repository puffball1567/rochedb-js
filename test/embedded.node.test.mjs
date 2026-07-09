import test from "node:test";
import assert from "node:assert/strict";
import { runEmbeddedCheck } from "./basic-check.mjs";

test("embedded put/get, retrieval, atlas, and orbit helpers", () => {
  runEmbeddedCheck(assert);
});

