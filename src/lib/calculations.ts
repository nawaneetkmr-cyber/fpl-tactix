export function calculateLivePoints(picks: any[], liveElements: any[]) {
  let total = 0;

  for (const pick of picks) {
    const playerLive = liveElements.find((p: any) => p.id === pick.element);
    if (!playerLive) continue;

    const points = playerLive.stats.total_points;
    total += points * pick.multiplier;
  }

  return total;
}

export function findBestCaptain(picks: any[], liveElements: any[]) {
  let best: { id: number | null; points: number } = { id: null, points: 0 };

  for (const pick of picks.filter((p: any) => p.multiplier > 0)) {
    const playerLive = liveElements.find((p: any) => p.id === pick.element);
    if (!playerLive) continue;

    if (playerLive.stats.total_points > best.points) {
      best = { id: pick.element, points: playerLive.stats.total_points };
    }
  }

  return best;
}
