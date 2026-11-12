import test from "node:test";
import assert from "node:assert/strict";
import { notifyPassUpdated } from "../lib/apns.js";

test("aucun push sans appareil ni sujet", async () => {
  const result = await notifyPassUpdated([], "pass.demo");
  assert.deepEqual(result, { pushed: 0, skipped: "nothing" });
});
