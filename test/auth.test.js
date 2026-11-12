import test from "node:test";
import assert from "node:assert/strict";
import { applePassAuthorized, cashierAuth } from "../lib/auth.js";

function run(headers, key) {
  const previous = process.env.PASSE_API_KEY;
  if (key === undefined) delete process.env.PASSE_API_KEY;
  else process.env.PASSE_API_KEY = key;
  const req = { get: (name) => headers[name.toLowerCase()] };
  let status = 0;
  let body;
  let passed = false;
  const res = {
    status(code) { status = code; return this; },
    json(payload) { body = payload; },
  };
  cashierAuth(req, res, () => { passed = true; });
  if (previous === undefined) delete process.env.PASSE_API_KEY;
  else process.env.PASSE_API_KEY = previous;
  return { status, body, passed };
}

test("sans PASSE_API_KEY la caisse reste ouverte", () => {
  const result = run({}, undefined);
  assert.equal(result.passed, true);
});

test("Wallet est accepté seulement avec le jeton ApplePass", () => {
  assert.equal(applePassAuthorized("ApplePass abcdefghijklmnop", "abcdefghijklmnop"), true);
  assert.equal(applePassAuthorized("Bearer abcdefghijklmnop", "abcdefghijklmnop"), false);
  assert.equal(applePassAuthorized("ApplePass autre-valeur-xxxx", "abcdefghijklmnop"), false);
});

test("une clé incorrecte est refusée, la bonne est acceptée", () => {
  const denied = run({ authorization: "Bearer autre" }, "secret-caisse");
  assert.equal(denied.passed, false);
  assert.equal(denied.status, 401);
  assert.equal(denied.body.auth, true);
  const allowed = run({ "x-api-key": "secret-caisse" }, "secret-caisse");
  assert.equal(allowed.passed, true);
});
