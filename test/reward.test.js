import test from "node:test";
import assert from "node:assert/strict";
import { presentCard, rewardView } from "../lib/reward.js";

test("un solde nul n'a franchi aucun palier", () => {
  assert.deepEqual(rewardView(0, 150), {
    rewardsEarned: 0,
    pointsIntoReward: 0,
    pointsToNext: 150,
  });
});

test("le reste après plusieurs paliers reste visible", () => {
  assert.deepEqual(rewardView(1240, 150), {
    rewardsEarned: 8,
    pointsIntoReward: 40,
    pointsToNext: 110,
  });
});

test("la carte publique ne contient pas le jeton Apple", () => {
  const card = presentCard({
    num: "1", nom: "A", pts: 150, reward: { at: 150, label: "cadeau" },
    authToken: "secret-token-value", updatedAt: "2026-01-01T00:00:00.000Z",
  });
  assert.equal(card.authToken, undefined);
  assert.equal(card.updatedAt, undefined);
  assert.equal(card.rewardsEarned, 1);
});

test("un solde pile sur le palier compte la récompense et rouvre un cycle", () => {
  assert.deepEqual(rewardView(150, 150), {
    rewardsEarned: 1,
    pointsIntoReward: 0,
    pointsToNext: 150,
  });
});
