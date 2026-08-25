/**
 * "Did you mean …?" support for validation messages (NFR-6: errors are for humans).
 * Pure, dependency-free, and deliberately conservative — a wrong suggestion is worse
 * than none, so only close matches qualify.
 */

/**
 * Row access whose bounds are guaranteed by the loops below. Asserting here keeps the
 * inner loop free of fallback branches that can never be taken — and therefore can
 * never be tested, which the core's 100% branch gate would rightly flag.
 */
const at = (row: readonly number[], index: number): number => row[index] as number;

/** Levenshtein edit distance. */
export const editDistance = (a: string, b: string): number => {
  const prev: number[] = Array.from({ length: b.length + 1 }, (_, i) => i);
  const curr: number[] = new Array<number>(b.length + 1).fill(0);

  for (let i = 1; i <= a.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(at(curr, j - 1) + 1, at(prev, j) + 1, at(prev, j - 1) + cost);
    }
    for (let j = 0; j <= b.length; j += 1) {
      prev[j] = at(curr, j);
    }
  }

  return at(prev, b.length);
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
