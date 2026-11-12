import test from "node:test";
import assert from "node:assert/strict";
import { rewardView } from "../lib/reward.js";

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

test("un solde pile sur le palier compte la récompense et rouvre un cycle", () => {
  assert.deepEqual(rewardView(150, 150), {
    rewardsEarned: 1,
    pointsIntoReward: 0,
    pointsToNext: 150,
  });
});
