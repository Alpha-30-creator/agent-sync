/**
 * "Did you mean …?" support for validation messages (NFR-6: errors are for humans).
 * Pure, dependency-free, and deliberately conservative — a wrong suggestion is worse
 * than none, so only close matches qualify.
 */

/** Levenshtein edit distance. */
export const editDistance = (a: string, b: string): number => {
  const prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr: number[] = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min((curr[j - 1] ?? 0) + 1, (prev[j] ?? 0) + 1, (prev[j - 1] ?? 0) + cost);
    }
    for (let j = 0; j <= b.length; j += 1) {
      prev[j] = curr[j] ?? 0;
    }
  }

  return prev[b.length] ?? 0;
};

/**
 * Closest candidate to `input`, or null when nothing is close enough.
 * Threshold scales with input length: short words tolerate one typo, longer ones two.
 */
export const suggest = (input: string, candidates: readonly string[]): string | null => {
  const normalized = input.toLowerCase();
  const threshold = normalized.length <= 4 ? 1 : 2;

  let best: string | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const candidate of candidates) {
    const distance = editDistance(normalized, candidate.toLowerCase());
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  }

  return bestDistance <= threshold ? best : null;
};
