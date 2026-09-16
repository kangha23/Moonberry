import { AREAS, TILE_SIZE, isWalkable, type AreaId } from '../world/areas';

/**
 * How a villager gets round the things in their way.
 *
 * They used to walk in a straight line, on the grounds that the village was
 * open ground and the only solid things in it were small enough to pass by
 * accident. That stopped being true one piece at a time — the well has a spot
 * on either side of it that half the village walks between, and a cottage is
 * four tiles by three — and by the time anybody measured, thirteen of the
 * legs in the schedules went straight through a house, the forge or the well.
 *
 * So: a distance field per destination, and a line pulled as tight as the
 * ground allows.
 *
 * - **The field** is a breadth-first flood out from the destination tile over
 *   every tile a villager can stand on. It depends only on the map and the
 *   destination, and the schedules name a handful of destinations, so each is
 *   worked out once and kept. Going downhill in it from any tile is a
 *   shortest route to the destination.
 * - **The line** is what stops that route being a staircase. From where the
 *   villager stands, the farthest tile along the downhill route that can be
 *   reached in a straight line without brushing anything solid is where they
 *   head. On open ground that is the destination itself, so a walk across the
 *   green is exactly the diagonal it always was; beside the well it is the
 *   corner of the well.
 *
 * Pure and deterministic, because it runs in the reducer — the server and an
 * offline browser have to walk the village the same way — and the caches are
 * functions of the map alone. Only the static map is considered: nothing a
 * player builds or drops is ever in the village, which is where villagers live.
 */

interface Point {
  x: number;
  y: number;
}

/** How far either side of the line a walker's body reaches, in world pixels. */
const BODY = 8;

/** The most tiles ahead a pulled line looks along the route. */
const LOOKAHEAD = 24;

const grids = new Map<AreaId, Uint8Array>();
const fields = new Map<string, Int32Array>();

/** 1 for every tile a villager can stand in the middle of, from the map alone. */
function walkGrid(area: AreaId): Uint8Array {
  let grid = grids.get(area);
  if (grid) return grid;
  const { width, height } = AREAS[area];
  grid = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      grid[y * width + x] = isWalkable(area, x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2) ? 1 : 0;
    }
  }
  grids.set(area, grid);
  return grid;
}

function tileOf(value: number): number {
  return Math.floor(value / TILE_SIZE);
}

function standable(area: AreaId, tileX: number, tileY: number): boolean {
  const { width, height } = AREAS[area];
  if (tileX < 0 || tileY < 0 || tileX >= width || tileY >= height) return false;
  return walkGrid(area)[tileY * width + tileX] === 1;
}

/** North, west, east, south — a fixed order, so ties always break the same way. */
const NEIGHBOURS = [
  [0, -1],
  [-1, 0],
  [1, 0],
  [0, 1],
] as const;

/** Steps from every tile to one destination tile, or -1 where it cannot be reached. */
function distanceField(area: AreaId, targetX: number, targetY: number): Int32Array {
  const key = `${area}:${targetX},${targetY}`;
  let field = fields.get(key);
  if (field) return field;

  const { width, height } = AREAS[area];
  field = new Int32Array(width * height).fill(-1);
  if (targetX >= 0 && targetY >= 0 && targetX < width && targetY < height) {
    const queue = [targetY * width + targetX];
    field[queue[0]] = 0;
    for (let head = 0; head < queue.length; head += 1) {
      const at = queue[head];
      const x = at % width;
      const y = (at - x) / width;
      for (const [dx, dy] of NEIGHBOURS) {
        const nx = x + dx;
        const ny = y + dy;
        if (!standable(area, nx, ny)) continue;
        const next = ny * width + nx;
        if (field[next] !== -1) continue;
        field[next] = field[at] + 1;
        queue.push(next);
      }
    }
  }
  fields.set(key, field);
  return field;
}

/** True when a body can go from `a` to `b` in a straight line without touching anything solid. */
function clearLine(area: AreaId, a: Point, b: Point): boolean {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return true;
  const nx = -dy / length;
  const ny = dx / length;
  const samples = Math.ceil(length / 4);
  for (let i = 0; i <= samples; i += 1) {
    const t = i / samples;
    const x = a.x + dx * t;
    const y = a.y + dy * t;
    for (const side of [-BODY, 0, BODY]) {
      if (!standable(area, tileOf(x + nx * side), tileOf(y + ny * side))) return false;
    }
  }
  return true;
}

/**
 * The point a walker at `from` should head for next on the way to `to`.
 *
 * `to` itself whenever it can be walked to in a straight line, and also when
 * there is no route at all — somebody standing somewhere they should not be,
 * or a destination nobody can reach, keeps the old straight-line walk rather
 * than freezing.
 */
export function waypointToward(area: AreaId, from: Point, to: Point): Point {
  if (clearLine(area, from, to)) return to;

  const { width } = AREAS[area];
  const field = distanceField(area, tileOf(to.x), tileOf(to.y));
  let tileX = tileOf(from.x);
  let tileY = tileOf(from.y);
  if (field[tileY * width + tileX] < 0) return to;

  // The downhill route, a tile at a time, as far as the lookahead goes.
  const route: Point[] = [];
  for (let step = 0; step < LOOKAHEAD; step += 1) {
    const here = field[tileY * width + tileX];
    if (here === 0) break;
    let best: [number, number] | null = null;
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = tileX + dx;
      const ny = tileY + dy;
      if (!standable(area, nx, ny)) continue;
      if (field[ny * width + nx] === here - 1) {
        best = [nx, ny];
        break;
      }
    }
    if (!best) break;
    [tileX, tileY] = best;
    const last = field[tileY * width + tileX] === 0;
    route.push(last ? to : { x: tileX * TILE_SIZE + TILE_SIZE / 2, y: tileY * TILE_SIZE + TILE_SIZE / 2 });
  }
  if (route.length === 0) return to;

  // The farthest point on the route there is a clear line to. The very next
  // tile is always taken if nothing further is, because the flood already
  // established that a walker can step onto it.
  for (let i = route.length - 1; i > 0; i -= 1) {
    if (clearLine(area, from, route[i])) return route[i];
  }
  return route[0];
}

/**
 * Walks up to `distance` world pixels from `from` toward `to`, around whatever
 * is in the way, and says where that ends.
 *
 * The distance is spent along the route rather than as the crow flies, so a
 * villager rounding the well keeps the pace of one crossing the green — with
 * one limit. The renderer draws each clock step as a single straight line from
 * where the step began to where it ended (`tickChase.ts`), so a step that went
 * round a corner would be drawn cutting straight across it, through the very
 * thing the route avoided. So a step ends at the farthest point along the
 * route that can still be seen from where it began. At most one corner in a
 * leg loses a little of one step to that, which nobody watching can tell from
 * a villager slowing to turn.
 */
export function walkToward(area: AreaId, from: Point, to: Point, distance: number): Point {
  const path: Point[] = [{ x: from.x, y: from.y }];
  let x = from.x;
  let y = from.y;
  let remaining = distance;

  // Bounded: every pass either arrives or reaches a waypoint, and the route to
  // anywhere in the village is far shorter than this.
  for (let pass = 0; pass < 64 && remaining > 0; pass += 1) {
    const waypoint = waypointToward(area, { x, y }, to);
    const dx = waypoint.x - x;
    const dy = waypoint.y - y;
    const gap = Math.hypot(dx, dy);
    if (gap === 0) break;
    if (gap <= remaining) {
      x = waypoint.x;
      y = waypoint.y;
      remaining -= gap;
      path.push({ x, y });
      if (x === to.x && y === to.y) break;
      continue;
    }
    x += (dx / gap) * remaining;
    y += (dy / gap) * remaining;
    remaining = 0;
    path.push({ x, y });
  }

  // Pull the end back along the route until the step's start can see it. The
  // first leg of the route is always visible — it was chosen for that — so
  // this always lands somewhere.
  const end = path[path.length - 1];
  if (path.length <= 2 || clearLine(area, from, end)) return end;
  for (let i = path.length - 1; i > 1; i -= 1) {
    const a = path[i - 1];
    const b = path[i];
    for (let t = 0.875; t > 0; t -= 0.125) {
      const candidate = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
      if (clearLine(area, from, candidate)) return candidate;
    }
    if (clearLine(area, from, a)) return a;
  }
  return path[1];
}
