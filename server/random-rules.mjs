function randomInt(max) {
  if (!Number.isSafeInteger(max) || max < 1) throw new RangeError('max must be a positive safe integer');
  const range = 0x1_0000_0000;
  const limit = Math.floor(range / max) * max;
  const sample = new Uint32Array(1);
  do {
    globalThis.crypto.getRandomValues(sample);
  } while (sample[0] >= limit);
  return sample[0] % max;
}

function requireCandidates(candidates) {
  if (!Array.isArray(candidates) || candidates.length === 0) {
    throw new TypeError('至少需要一个有效候选项。');
  }
}

export function chooseTimedOutOption(candidates, drawIndex = randomInt) {
  requireCandidates(candidates);
  const index = drawIndex(candidates.length);
  return {index, option: candidates[index]};
}

export function chooseJointDefenders(perfectPlayerIds, drawIndex = randomInt) {
  if (!Array.isArray(perfectPlayerIds)) throw new TypeError('完美作战者必须是数组。');
  const unique = [...new Set(perfectPlayerIds)];
  if (unique.some(id => typeof id !== 'string' || !id)) {
    throw new TypeError('玩家 ID 必须是非空字符串。');
  }
  if (unique.length <= 2) return [...unique];

  const pool = [...unique];
  for (let i = 0; i < 2; i += 1) {
    const selected = i + drawIndex(pool.length - i);
    [pool[i], pool[selected]] = [pool[selected], pool[i]];
  }
  return pool.slice(0, 2);
}
