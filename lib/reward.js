/** Progression vers la prochaine récompense, et nombre de paliers déjà franchis. */
export function rewardView(points, threshold) {
  const at = Number.isFinite(Number(threshold)) && Number(threshold) > 0 ? Math.floor(Number(threshold)) : 1;
  const pts = Math.max(0, Math.floor(Number(points) || 0));
  const rewardsEarned = Math.floor(pts / at);
  const pointsIntoReward = pts % at;
  const pointsToNext = pointsIntoReward === 0 ? at : at - pointsIntoReward;
  return { rewardsEarned, pointsIntoReward, pointsToNext };
}

/** Carte renvoyée au navigateur : jamais le jeton du pass Apple. */
export function presentCard(card) {
  if (!card) return null;
  const { authToken, updatedAt, ...rest } = card;
  return { ...rest, ...rewardView(rest.pts, rest.reward?.at) };
}
