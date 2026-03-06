function normalize(value: string): string {
  return value.trim().replace(/^\//, "").toLowerCase();
}

function toRanges(indexes: number[]): Array<{ start: number; end: number }> {
  if (indexes.length === 0) {
    return [];
  }

  const ranges: Array<{ start: number; end: number }> = [];
  let start = indexes[0];
  let end = start + 1;

  for (let index = 1; index < indexes.length; index += 1) {
    const value = indexes[index];
    if (value === end) {
      end += 1;
      continue;
    }
    ranges.push({ start, end });
    start = value;
    end = value + 1;
  }

  ranges.push({ start, end });
  return ranges;
}

export function fuzzyScore(query: string, candidate: string): { score: number; matchedRanges: Array<{ start: number; end: number }> } | null {
  const normalizedQuery = normalize(query);
  const normalizedCandidate = normalize(candidate);

  if (!normalizedQuery) {
    return { score: 1, matchedRanges: [] };
  }

  if (normalizedCandidate === normalizedQuery) {
    return {
      score: 1000,
      matchedRanges: [{ start: 0, end: normalizedCandidate.length }]
    };
  }

  if (normalizedCandidate.startsWith(normalizedQuery)) {
    return {
      score: 800 - (normalizedCandidate.length - normalizedQuery.length),
      matchedRanges: [{ start: 0, end: normalizedQuery.length }]
    };
  }

  const indexes: number[] = [];
  let cursor = 0;
  for (const character of normalizedQuery) {
    const nextIndex = normalizedCandidate.indexOf(character, cursor);
    if (nextIndex === -1) {
      return null;
    }
    indexes.push(nextIndex);
    cursor = nextIndex + 1;
  }

  let gaps = 0;
  for (let index = 1; index < indexes.length; index += 1) {
    gaps += indexes[index] - indexes[index - 1] - 1;
  }

  const startsAtBoundary = indexes[0] === 0 || normalizedCandidate[indexes[0] - 1] === "-";
  const score = 500 - gaps * 5 - (normalizedCandidate.length - normalizedQuery.length) + (startsAtBoundary ? 40 : 0);

  return {
    score,
    matchedRanges: toRanges(indexes)
  };
}
