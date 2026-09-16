/**
 * Spec 13 — Mỏ và chiến đấu: sinh tầng tất định, bảng độ sâu, và các con số
 * của chiến đấu.
 *
 * Mọi thứ ở đây là hàm thuần và tất định: cùng hạt và cùng độ sâu luôn cho
 * ra cùng một tầng, nên server và mọi máy khách thấy cùng một cái mỏ mà
 * không cần gửi gì qua dây. Số quái và công thức damage học từ Emberfield
 * (skeleton 50 HP / đánh 15, i-frame 0.5s) nhưng viết lại cho vừa reducer:
 * quái đi thẳng về phía người gần nhất, không A*.
 *
 * Chỉ import *kiểu* từ `world/`: `areas.ts` hỏi file này kích thước tầng lúc
 * nạp module, nên một import runtime ngược lại sẽ thành vòng.
 */
import type { AreaId, TileKind } from '../world/areas';
import type { ItemId } from './items';

export const MAX_DEPTH = 40;
export const ELEVATOR_EVERY = 5;

export type OreId = 'stone' | 'coal' | 'copper-ore' | 'iron-ore' | 'gold-ore' | 'gem';

export type MonsterKind =
  | 'green-slime'
  | 'slime'
  | 'bat'
  | 'rock-bug'
  | 'ghost'
  | 'floor-boss';

export interface Point {
  x: number;
  y: number;
}

export interface OreNode {
  x: number;
  y: number;
  ore: OreId;
}

/** Where a monster starts on a fresh floor, in tiles. */
export interface MonsterSpawn {
  id: string;
  kind: MonsterKind;
  x: number;
  y: number;
  health: number;
}

export interface MineFloor {
  depth: number;
  width: number;
  height: number;
  /** Row-major: `tiles[y][x]`. Only `'floor'` and `'wall'` appear. */
  tiles: TileKind[][];
  entrance: Point;
  ladder: Point | null;
  hasElevator: boolean;
  ores: OreNode[];
  monsters: MonsterSpawn[];
}

/**
 * A monster that is awake, because somebody is standing on its floor.
 *
 * On `FarmState` rather than on the floor, and only while the floor has an
 * online player on it: the list is forgotten when the last one leaves and
 * rebuilt from the seed when somebody comes back, so it never needs saving.
 */
export interface Monster {
  id: string;
  kind: MonsterKind;
  /** `mine:12`. */
  area: AreaId;
  /** World pixels, like a player. */
  x: number;
  y: number;
  health: number;
  /** Minute of the day it may strike again. */
  nextAttackAt: number;
  /**
   * Minute of the day it can be hurt again. One sword swing per clock step,
   * whatever rate a client sends `attack` at.
   */
  invulnerableUntil: number;
}

/** FNV-1a 32-bit, cùng họ với hash trong `resources.ts`. */
function hash(...parts: Array<string | number>): number {
  let value = 0x811c9dc5;
  const text = parts.join(':');
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

function roll(...parts: Array<string | number>): number {
  return hash(...parts) / 0x100000000;
}

function between(min: number, max: number, ...parts: Array<string | number>): number {
  return min + (hash(...parts) % (max - min + 1));
}

/**
 * Hạt của mỏ hôm nay. Đổi mỗi ngày nên tầng 5 hôm sau là một tầng 5 khác, và
 * vì nó chỉ là hàm của hai số đã lưu nên không cần lưu trạng thái tầng nào.
 */
export function mineSeedFor(worldSeed: number, day: number): number {
  return hash(worldSeed, day);
}

/** Quặng theo dải độ sâu trong spec 13. */
export function oreTable(depth: number): OreId[] {
  if (depth >= MAX_DEPTH) return ['stone', 'coal', 'gold-ore', 'gem'];
  if (depth >= 30) return ['stone', 'coal', 'gold-ore'];
  if (depth >= 20) return ['stone', 'coal', 'iron-ore', 'gold-ore'];
  if (depth >= 10) return ['stone', 'coal', 'iron-ore'];
  return ['stone', 'coal', 'copper-ore'];
}

/** Quái theo dải độ sâu trong spec 13. */
export function monsterTable(depth: number): MonsterKind[] {
  if (depth >= MAX_DEPTH) return ['floor-boss'];
  if (depth >= 30) return ['rock-bug', 'ghost'];
  if (depth >= 20) return ['bat', 'rock-bug'];
  if (depth >= 10) return ['green-slime', 'slime', 'bat'];
  return ['green-slime'];
}

export const MONSTER_HEALTH: Record<MonsterKind, number> = {
  'green-slime': 30,
  'slime': 40,
  'bat': 35,
  'rock-bug': 60,
  'ghost': 80,
  'floor-boss': 400,
};

/** Máu một đòn quái lấy đi, trước giáp. Người chơi có 100. */
export const MONSTER_ATTACK: Record<MonsterKind, number> = {
  'green-slime': 6,
  'slime': 8,
  'bat': 10,
  'rock-bug': 14,
  'ghost': 18,
  'floor-boss': 30,
};

/** Quái thấy người trong bán kính này, tính bằng ô. Ngoài tầm thì đứng yên. */
export const MONSTER_SIGHT_TILES = 8;
/** Quãng một con quái đi trong một bước đồng hồ, bằng pixel. */
export const MONSTER_STEP_PX = 20;
/** Gần thế này thì chạm tới người, bằng pixel. */
export const MONSTER_REACH_PX = 24;
/** Phút giữa hai đòn của cùng một con quái. */
export const MONSTER_ATTACK_COOLDOWN = 6;
/**
 * Phút vô hiệu sau khi trúng đòn. Hai bước đồng hồ: đủ để hai con sên đứng
 * cùng chỗ không đánh hai lần một lúc, đủ ngắn để đứng lì trong ổ sên vẫn đau.
 */
export const INVULNERABLE_MINUTES = 4;
/** Tầm vung kiếm, bằng pixel, và nửa góc của hình quạt (cos 60°). */
export const SWORD_REACH_PX = 56;
export const SWORD_FAN_COS = 0.5;

/** Thứ bị tính là "đồ đào" khi ngất. */
export const MINED_ITEMS: readonly ItemId[] = ['stone', 'coal', 'copper-ore', 'iron-ore', 'gold-ore', 'gem'];
/** Phần mỗi loại đồ đào mất khi ngất, làm tròn lên. */
export const FAINT_ORE_LOSS_SHARE = 0.5;

/** Sát thương sau giáp, không bao giờ dưới 1. */
export function strikeDamage(raw: number, defense: number): number {
  return Math.max(1, raw - defense);
}

export interface LootRoll {
  drops: Array<{ item: string; count: number }>;
  coins: number;
}

/**
 * Loot của một con quái, cố định từ lúc nó spawn: cùng hạt, cùng id và
 * cùng tầng thì rớt cùng thứ, chạy lại vẫn vậy.
 */
export function rollLoot(seed: number, monsterId: string, depth: number): LootRoll {
  const ores = oreTable(depth).filter((ore) => ore !== 'stone');
  const pick = ores[hash(seed, monsterId, depth) % ores.length] ?? 'coal';
  return {
    drops: [{ item: pick, count: between(1, 2, seed, monsterId, depth, 'n') }],
    coins: between(5, 15, seed, monsterId, depth, 'coins'),
  };
}

/**
 * Cạnh của tầng theo độ sâu, 24 tới 40. Chỉ phụ thuộc độ sâu, không phụ thuộc
 * hạt, nên `areaMap('mine:12')` biết kích thước mà không cần biết hôm nay.
 */
export function floorSize(depth: number): number {
  return Math.min(40, 24 + 2 * Math.floor((Math.max(1, depth) - 1) / ELEVATOR_EVERY));
}

/**
 * Đục hang: một đường đi ngẫu nhiên từ lối vào tới thang, kéo dần về phía
 * thang, rồi vài phòng nối vào đường đó bằng cùng kiểu đi.
 *
 * Mỗi bước chỉ nhích một ô và mở một khối 2x2, nên đường đi không bao giờ
 * đứt và hành lang luôn rộng hai ô — đủ để quái đi thẳng mà không tìm đường.
 * Viền ngoài luôn là tường.
 */
function carve(seed: number, depth: number, size: number, entrance: Point, ladder: Point): TileKind[][] {
  const tiles: TileKind[][] = Array.from({ length: size }, () => Array<TileKind>(size).fill('wall'));
  const inside = (value: number) => Math.min(size - 2, Math.max(1, value));
  const open = (x: number, y: number) => {
    for (let dy = 0; dy < 2; dy += 1) {
      for (let dx = 0; dx < 2; dx += 1) tiles[inside(y + dy)][inside(x + dx)] = 'floor';
    }
  };

  const walk = (from: Point, to: Point, label: string): Point[] => {
    let x = from.x;
    let y = from.y;
    const trail: Point[] = [{ x, y }];
    open(x, y);
    const limit = size * size * 2;
    for (let step = 0; step < limit && (x !== to.x || y !== to.y); step += 1) {
      if (roll(seed, depth, label, step) < 0.6) {
        // Về phía đích, theo trục còn xa hơn — hoặc theo hạt khi hai trục ngang nhau.
        const alongX = Math.abs(to.x - x) > Math.abs(to.y - y) ||
          (Math.abs(to.x - x) === Math.abs(to.y - y) && hash(seed, depth, label, 'axis', step) % 2 === 0);
        if (alongX) x += Math.sign(to.x - x);
        else y += Math.sign(to.y - y);
      } else {
        const direction = hash(seed, depth, label, 'dir', step) % 4;
        if (direction === 0) x = inside(x + 1);
        else if (direction === 1) x = inside(x - 1);
        else if (direction === 2) y = inside(y + 1);
        else y = inside(y - 1);
      }
      open(x, y);
      trail.push({ x, y });
    }
    // Không bao giờ chạm tới trong thực tế, nhưng một tầng không có đường tới
    // thang là lỗi không được phép có, nên đoạn cuối đi thẳng cho chắc.
    while (x !== to.x) {
      x += Math.sign(to.x - x);
      open(x, y);
      trail.push({ x, y });
    }
    while (y !== to.y) {
      y += Math.sign(to.y - y);
      open(x, y);
      trail.push({ x, y });
    }
    return trail;
  };

  const tunnel = walk(entrance, ladder, 'tunnel');

  const rooms = between(3, 5, seed, depth, 'rooms');
  for (let i = 0; i < rooms; i += 1) {
    const width = between(4, 7, seed, depth, 'room-w', i);
    const height = between(4, 6, seed, depth, 'room-h', i);
    const left = between(1, size - 2 - width, seed, depth, 'room-x', i);
    const top = between(1, size - 2 - height, seed, depth, 'room-y', i);
    for (let y = top; y < top + height; y += 1) {
      for (let x = left; x < left + width; x += 1) tiles[y][x] = 'floor';
    }
    const joinTo = tunnel[hash(seed, depth, 'room-join', i) % tunnel.length];
    walk({ x: left + Math.floor(width / 2), y: top + Math.floor(height / 2) }, joinTo, `room-${i}`);
  }

  return tiles;
}

/**
 * Sinh một tầng mỏ. Thang luôn tồn tại ở góc xa lối vào — thang giấu
 * trong đá như Stardew bị loại cố ý, vì trong thế giới bốn người nó biến
 * một người thành kẻ giữ cả nhóm lại.
 */
export function generateFloor(seed: number, depth: number): MineFloor {
  const size = floorSize(depth);
  const width = size;
  const height = size;
  const entrance: Point = { x: 1, y: 1 };
  const ladder: Point = { x: width - 2, y: height - 2 };
  const tiles = carve(seed, depth, size, entrance, ladder);

  // Mọi ô sàn, theo thứ tự hàng, để việc rải là chọn chỉ số chứ không phải
  // thử toạ độ rồi hy vọng không trúng tường.
  const floorCells: Point[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) if (tiles[y][x] === 'floor') floorCells.push({ x, y });
  }
  const fromEntrance = (cell: Point) => Math.abs(cell.x - entrance.x) + Math.abs(cell.y - entrance.y);
  const isLadder = (cell: Point) => cell.x === ladder.x && cell.y === ladder.y;
  const taken = new Set<string>();
  const pick = (cells: Point[], ...parts: Array<string | number>): Point | null => {
    if (cells.length === 0) return null;
    // Vài lần thử trên các ô kế tiếp, để hai thứ không chồng lên một ô.
    const start = hash(seed, depth, ...parts) % cells.length;
    for (let probe = 0; probe < cells.length; probe += 1) {
      const cell = cells[(start + probe) % cells.length];
      const key = `${cell.x},${cell.y}`;
      if (taken.has(key)) continue;
      taken.add(key);
      return cell;
    }
    return null;
  };

  const ores: OreNode[] = [];
  const oreCells = floorCells.filter((cell) => fromEntrance(cell) > 2 && !isLadder(cell));
  const oreDensity = Math.min(24, 8 + depth);
  const table = oreTable(depth);
  for (let i = 0; i < oreDensity; i += 1) {
    const cell = pick(oreCells, 'ore', i);
    if (!cell) break;
    ores.push({ ...cell, ore: table[hash(seed, depth, 'ore-kind', i) % table.length] });
  }

  const kinds = monsterTable(depth);
  const monsterCells = floorCells.filter((cell) => fromEntrance(cell) >= 8 && !isLadder(cell));
  const monsterCount = depth >= MAX_DEPTH ? 1 : Math.min(8, 2 + Math.floor(depth / 5));
  const monsters: MonsterSpawn[] = [];
  for (let i = 0; i < monsterCount; i += 1) {
    const cell = pick(monsterCells, 'monster', i);
    if (!cell) break;
    const kind = kinds[hash(seed, depth, 'kind', i) % kinds.length];
    monsters.push({ id: `m${depth}-${i}`, kind, ...cell, health: MONSTER_HEALTH[kind] });
  }

  return {
    depth,
    width,
    height,
    tiles,
    entrance,
    ladder,
    hasElevator: depth % ELEVATOR_EVERY === 0,
    ores,
    monsters,
  };
}

/**
 * Bộ nhớ đệm thuần: tầng dựng lại được từ hạt, nên đây không phải state và
 * không vào bản lưu. Giới hạn cỡ để một server chạy nhiều ngày không giữ mãi
 * mọi tầng của mọi hôm qua.
 */
const FLOOR_CACHE_LIMIT = 64;
const floorCache = new Map<string, MineFloor>();

export function floorFor(seed: number, depth: number): MineFloor {
  const key = `${seed}:${depth}`;
  let floor = floorCache.get(key);
  if (!floor) {
    floor = generateFloor(seed, depth);
    if (floorCache.size >= FLOOR_CACHE_LIMIT) {
      const oldest = floorCache.keys().next().value;
      if (oldest !== undefined) floorCache.delete(oldest);
    }
    floorCache.set(key, floor);
  }
  return floor;
}
