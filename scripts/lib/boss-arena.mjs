const parseBounds = value => String(value).match(/-?\d+/g).map(Number);

function walkGrid(grid, from, to) {
  const key = p => `${p.x},${p.y}`;
  const start = key(from), goal = key(to), queue = [from], previous = new Map([[start, null]]);
  const ground = (x, y) => {
    const tile = grid[y]?.[x];
    return !!tile && tile.passableMask !== 'NONE' && tile.passableMask !== 'FLY_ONLY' && !tile.obstacle;
  };
  while (queue.length && !previous.has(goal)) {
    const point = queue.shift();
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const next = {x: point.x + dx, y: point.y + dy}, nextKey = key(next);
      if (!ground(next.x, next.y) || previous.has(nextKey)) continue;
      previous.set(nextKey, point);
      queue.push(next);
    }
  }
  if (!previous.has(goal)) return null;
  const route = [];
  let point = to;
  while (point && key(point) !== start) {
    route.unshift(point);
    point = previous.get(key(point));
  }
  return route;
}

export function buildBossArena(level, blackboard) {
  const leftBounds = parseBounds(blackboard.leftBoss);
  const rightBounds = parseBounds(blackboard.rightBoss);
  const [bottom, left, top] = leftBounds;
  const right = rightBounds[3];
  if (rightBounds[0] !== bottom || rightBounds[2] !== top || leftBounds[3] + 1 !== rightBounds[1]) {
    throw Error(`最终 Boss 左右地图裁切不连续：${level.levelId}`);
  }

  const grid = [];
  for (let row = top; row >= bottom; row--) {
    const line = [];
    for (let col = left; col <= right; col++) {
      const tile = {...level.mapData.tiles[level.mapData.map[level.mapData.map.length - 1 - row][col]]};
      if (tile.tileKey === 'tile_achand') {
        tile.buildableType = 'NONE';
        tile.zone = 'bench';
      } else if (tile.tileKey === 'tile_forbidden') tile.zone = 'void';
      else if (tile.tileKey === 'tile_deepsea') tile.buildableType = 'NONE';
      line.push(tile);
    }
    grid.push(line);
  }

  const inBounds = position => position.row >= bottom && position.row <= top && position.col >= left && position.col <= right;
  const devices = (level.predefines?.tokenInsts || []).filter(token => !token.hidden && inBounds(token.position)).map(token => ({
    id: token.inst.characterKey,
    x: token.position.col - left,
    y: top - token.position.row,
    direction: token.direction
  }));
  const windSources = (level.predefines?.tokenInsts || []).filter(token =>
    !token.hidden && token.inst.characterKey === 'trap_013_blower' && inBounds(token.position)
  ).map(token => ({x: token.position.col - left, y: top - token.position.row, direction: token.direction}));

  for (const device of devices) {
    const tile = grid[device.y][device.x];
    tile.device = device.id;
    tile.direction = device.direction;
    if (device.id === 'trap_1105_accrate' || device.id === 'trap_1107_acblock') {
      tile.buildableType = 'NONE';
      tile.passableMask = 'FLY_ONLY';
      tile.obstacle = true;
    }
    if (device.id === 'trap_1106_achplat') {
      tile.buildableType = 'RANGED';
      tile.heightType = 'HIGHLAND';
      tile.passableMask = 'FLY_ONLY';
    }
    if (device.id === 'trap_040_canoe') {
      tile.buildableType = 'ALL';
      tile.passableMask = 'ALL';
    }
  }

  const field = grid.flatMap((row, y) => row.map((tile, x) => ({tile, x, y}))).filter(({tile}) => !tile.zone);
  if (!field.length) throw Error(`最终 Boss 地图没有可见地块：${level.levelId}`);
  const viewport = {
    left: Math.min(...field.map(point => point.x)),
    right: Math.max(...field.map(point => point.x)),
    top: Math.min(...field.map(point => point.y)),
    bottom: Math.max(...field.map(point => point.y))
  };
  const ground = (x, y) => {
    const tile = grid[y]?.[x];
    return !!tile && tile.passableMask !== 'NONE' && tile.passableMask !== 'FLY_ONLY' && !tile.obstacle;
  };
  const groundCells = grid.flatMap((row, y) => row.map((tile, x) => ({tile, x, y}))).filter(point => ground(point.x, point.y));
  const entrances = groundCells.filter(point => point.tile.tileKey === 'tile_telin').sort((a, b) => a.x - b.x || a.y - b.y);
  const exits = groundCells.filter(point => point.tile.tileKey === 'tile_end');
  if (entrances.length !== 2 || exits.length !== 2) throw Error(`最终 Boss 地图缺少两处入口或目标：${level.levelId}`);

  const remainingExits = exits.slice();
  const rawPosition = point => ({col: left + point.x, row: top - point.y});
  const bossDoorRoutes = entrances.map(entrance => {
    const candidates = remainingExits.map(exit => ({exit, route: walkGrid(grid, entrance, exit)})).filter(item => item.route);
    candidates.sort((a, b) => a.route.length - b.route.length || a.exit.x - b.exit.x);
    const exit = candidates[0]?.exit;
    if (!exit) throw Error(`最终 Boss 入口没有通向目标的路线：${level.levelId} ${entrance.x},${entrance.y}`);
    remainingExits.splice(remainingExits.indexOf(exit), 1);
    return {
      motionMode: 'WALK',
      startPosition: rawPosition(entrance),
      endPosition: rawPosition(exit),
      spawnRandomRange: {x: 0, y: 0},
      spawnOffset: {x: 0, y: 0},
      checkpoints: [],
      allowDiagonalMove: false,
      visitEveryTileCenter: false,
      visitEveryNodeCenter: false,
      visitEveryCheckPoint: false
    };
  });

  const topY = Math.min(...groundCells.map(point => point.y));
  const bottomY = Math.max(...groundCells.map(point => point.y));
  const topCells = groundCells.filter(point => point.y === topY);
  const start = topCells.reduce((a, b) => b.x > a.x ? b : a);
  const waypoints = [start];
  for (const point of topCells.slice().sort((a, b) => b.x - a.x)) waypoints.push({x: point.x, y: point.y});
  for (let y = topY + 1; y <= bottomY; y++) {
    const row = groundCells.filter(point => point.y === y);
    if (row.length) waypoints.push(row.reduce((a, b) => b.x < a.x ? b : a));
  }
  for (const point of groundCells.filter(point => point.y === bottomY).sort((a, b) => a.x - b.x)) waypoints.push({x: point.x, y: point.y});
  for (let y = bottomY - 1; y > topY; y--) {
    const row = groundCells.filter(point => point.y === y);
    if (row.length) waypoints.push(row.reduce((a, b) => b.x > a.x ? b : a));
  }
  for (const point of topCells.slice().sort((a, b) => a.x - b.x)) waypoints.push({x: point.x, y: point.y});

  const ring = [];
  let cursor = start;
  for (const point of waypoints.slice(1)) {
    const segment = walkGrid(grid, cursor, point);
    if (!segment) throw Error(`最终 Boss 环绕路线不连通：${level.levelId} ${cursor.x},${cursor.y} -> ${point.x},${point.y}`);
    ring.push(...segment);
    cursor = point;
  }
  const closing = walkGrid(grid, cursor, start);
  if (!closing) throw Error(`最终 Boss 环绕路线无法闭合：${level.levelId}`);
  ring.push(...closing);
  if (ring.length < 8 || ring.at(-1)?.x !== start.x || ring.at(-1)?.y !== start.y) throw Error(`最终 Boss 环绕路线没有闭合：${level.levelId}`);

  return {
    devices,
    windSources,
    bossDoorRoutes,
    bossPatrolRoute: [start, ...ring].map((point, checkpointIndex) => ({kind: 'move', x: point.x, y: point.y, checkpointIndex})),
    viewport,
    rows: grid.length,
    cols: grid[0].length,
    origin: {row: top, col: left},
    grid
  };
}
