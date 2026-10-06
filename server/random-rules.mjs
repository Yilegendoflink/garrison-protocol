import {randomInt} from 'node:crypto';

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
