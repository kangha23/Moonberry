import {
  BUILDING_AREA,
  buildingAt,
  buildingsOn,
  type Building,
} from './buildings';
import type { PlotState } from './farming';
import { addItem, type Inventory } from './inventory';
import { groundIsClaimed, nextSequentialId, tileRect, type Placeable } from './placeables';
import {
  FORAGE_BY_SEASON,
  ITEMS,
  itemDef,
  type ItemId,
  type Tool,
  type ToolTier,
} from './items';
import { dayOfSeason, type Season } from './time';
import {
  AREA_IDS,
  TILE_SIZE,
  areaMap,
  plotKey,
  tileAt,
  type AreaId,
  type Blocker,
} from '../world/areas';

/**
 * What is standing on the ground that a tool can take down.
 *
 * A node is **state**, not map data, and that is the whole of why this file
 * exists. `maps/*.json` is static and identical in every world; a stump that
 * has been chopped is neither. It is the same lesson the buildings taught in
 * spec 06, and it carries the same cost, stated plainly because it catches
 * people out: collision is not a map property. `isWalkable` has to be handed
 * these too.
 */
export type NodeKind =
  /** Chopped for wood. Grows through five stages and seeds new ones. */
  | 'tree'
  /** What the last tenant left behind. Hardwood, and a copper axe to reach it. */
  | 'stump'
  | 'rock'
  /** The big one. Stone and sometimes coal, and a steel pick to break it. */
  | 'boulder'
  /** Weeds. Fibre, and the reason the first week is about clearing land. */
  | 'weed'
  /** Grass. Hay into the silo, and nothing into the satchel. */
  | 'grass'
  /** Something worth picking up, which is different in each season. */
  | 'forage';

export interface ResourceNode {
  id: string;
  kind: NodeKind;
  area: AreaId;
  x: number;
  y: number;
  /** Swings left. 0 means it has fallen, which is a node that no longer exists. */
  health: number;
  /**
   * The lowest tool tier that marks it at all.
   *
   * Stored rather than read off the kind, which looks like duplication and is
   * not: it is what lets one kind carry different hardnesses — a mineral vein
   * in spec 13 is a `rock` that wants a better pick — without a second kind
   * and a second sprite for every rung of the ladder.
   */
  requires: ToolTier;
  /** For a tree: 0-4, how grown it is. Null for anything that does not grow. */
  stage: number | null;
  /** For `forage`: which item it is. Null for everything else. */
  item: ItemId | null;
}

export interface NodeDef {
  kind: NodeKind;
  label: string;
  /**
   * The implement that works it, or null for something picked up by hand.
   *
   * One tool per kind and no overlap, deliberately: a player who swings the
   * wrong thing should be told which is right, and "the axe sometimes clears
   * weeds" is a rule nobody can hold in their head while clearing a field.
   */
  tool: Tool | null;
  /** Swings at full size. A tree that is still growing is softer — see `healthOf`. */
  health: number;
  requires: ToolTier;
  /**
   * What one swing costs.
   *
   * The scythe is free, like harvesting. Cutting grass is a chore rather than
   * a decision, and charging for it only makes the day shorter.
   */
  energy: number;
  /** Whether a walker has to go round it. */
  solid: boolean;
  blurb: string;
}

/**
 * The seven things that stand on the ground.
 *
 * Energy is the tuning that matters here, and it is tuned against spec 01's
 * budget rather than against anything in this file: a mature tree is five
 * swings at 4, so twenty energy, and 270 buys a morning of thirteen trees or a
 * morning of watering — never both. That choice, between two jobs that are
 * both the right thing to do, is the whole reason this spec exists.
 */
export const NODE_DEFS: Record<NodeKind, NodeDef> = {
  tree: {
    kind: 'tree',
    label: 'Cái cây',
    tool: 'axe',
    health: 5,
    requires: 'basic',
    energy: 4,
    solid: true,
    blurb: 'Gỗ, và thỉnh thoảng một ít nhựa cây.',
  },
  stump: {
    kind: 'stump',
    label: 'Gốc cây',
    tool: 'axe',
    health: 4,
    requires: 'copper',
    energy: 4,
    solid: true,
    blurb: 'Gỗ cứng, nếu bạn có cái rìu đủ sắc.',
  },
  rock: {
    kind: 'rock',
    label: 'Hòn đá',
    tool: 'pickaxe',
    health: 2,
    requires: 'basic',
    energy: 3,
    solid: true,
    blurb: 'Đá xây. Hai nhát là xong.',
  },
  boulder: {
    kind: 'boulder',
    label: 'Tảng đá',
    tool: 'pickaxe',
    health: 4,
    requires: 'steel',
    energy: 3,
    solid: true,
    blurb: 'Đá, và đôi khi một cục than. Cần cuốc chim thép.',
  },
  weed: {
    kind: 'weed',
    label: 'Bụi cỏ dại',
    tool: 'scythe',
    health: 1,
    requires: 'basic',
    energy: 0,
    solid: false,
    blurb: 'Một nhát liềm, và một sợi.',
  },
  grass: {
    kind: 'grass',
    label: 'Đám cỏ',
    tool: 'scythe',
    health: 1,
    requires: 'basic',
    energy: 0,
    solid: false,
    blurb: 'Cắt bằng liềm thì thành cỏ khô trong kho.',
  },
  forage: {
    kind: 'forage',
    label: 'Đồ hái',
    tool: null,
    health: 1,
    requires: 'basic',
    energy: 0,
    solid: false,
    blurb: 'Nhặt lên là được. Không cần nông cụ nào cả.',
  },
};

export function nodeDef(kind: NodeKind): NodeDef {
  return NODE_DEFS[kind];
}

export function isNodeKind(value: unknown): value is NodeKind {
  return typeof value === 'string' && Object.hasOwn(NODE_DEFS, value);
}

/** How grown a tree has to be before it is worth chopping. */
export const TREE_MATURE_STAGE = 4;

/** How many stages a tree passes through, seedling to canopy. */
export const TREE_STAGES = TREE_MATURE_STAGE + 1;

/**
 * What this node takes to fell, which for a tree depends on how big it is.
 *
 * A seedling is one swing and one stick, so clearing a sapling that came up in
 * the wrong place is an afternoon's decision rather than a morning's work.
 */
export function healthOf(kind: NodeKind, stage: number | null): number {
  if (kind !== 'tree') return NODE_DEFS[kind].health;
  return stage !== null && stage >= TREE_MATURE_STAGE ? NODE_DEFS.tree.health : 1;
}

// --- what grows where --------------------------------------------------------

/**
 * Which three things a season puts out.
 *
 * The table itself lives in `items.ts`, because the item table must not depend
 * on the systems that name its rows; what lives here is where they grow. They
 * are the second reason to walk to the village and the woods, and they are the
 * reason Juniper's dialogue is true rather than aspirational: she has talked
 * about foraging the hedgerows since spec 07 with nothing in the world to
 * forage.
 */
export { FORAGE_BY_SEASON, FORAGE_IDS, isForageItem } from './items';

// --- ids and lookups ---------------------------------------------------------

/** How a tile is named in the index and in the spawn rules below. */
function tileKey(area: AreaId, x: number, y: number): string {
  return `${area}:${x},${y}`;
}

/**
 * The next free id, derived from the ids in use.
 *
 * Derived rather than drawn, for the same reason `nextBuildingId` is: the
 * reducer is pure, and the server and an offline browser have to build the
 * same world out of the same intents. Taking the maximum rather than counting
 * matters more here than it does for buildings, because nodes are removed all
 * the time — counting would hand out an id that is still standing.
 */
export function nextNodeId(nodes: readonly ResourceNode[]): string {
  return nextSequentialId('n', nodes);
}

/**
 * The four questions everything asks of the node list, answered off one index.
 *
 * A farm carries a couple of hundred of these and the wood carries as many
 * again, and three separate things ask about them on **every frame**: the
 * prompt bar wants the tile ahead, the cursor wants the tile under the mouse,
 * and movement wants the whole map's collision rectangles. Answered by walking
 * the array that was a thousand scans of five hundred items a second, and the
 * allocation from rebuilding the collision list on every step was worse than
 * the scanning.
 *
 * Memoised on the array's identity, which is exact rather than approximate:
 * the reducer is immutable, so a list that has not been replaced is a list
 * nothing has changed. One entry is enough — every caller in a frame is asking
 * about the same farm — and the functions stay pure in the only sense that
 * matters here, which is that the same input always gives the same answer.
 *
 * The same trick `selectors.ts` uses on the shop stock, for the same reason
 * and with the same caveat: never cache anything a caller could mutate.
 */
interface NodeIndex {
  byTile: Map<string, ResourceNode>;
  byArea: Map<AreaId, ResourceNode[]>;
  solid: Map<AreaId, Blocker[]>;
}

let indexed: { nodes: readonly ResourceNode[]; index: NodeIndex } | null = null;

function indexOf(nodes: readonly ResourceNode[]): NodeIndex {
  if (indexed?.nodes === nodes) return indexed.index;

  const index: NodeIndex = { byTile: new Map(), byArea: new Map(), solid: new Map() };
  for (const node of nodes) {
    index.byTile.set(tileKey(node.area, node.x, node.y), node);

    const here = index.byArea.get(node.area);
    if (here) here.push(node);
    else index.byArea.set(node.area, [node]);

    if (!NODE_DEFS[node.kind].solid) continue;
    const rect = tileRect(node.x, node.y);
    const blocking = index.solid.get(node.area);
    if (blocking) blocking.push(rect);
    else index.solid.set(node.area, [rect]);
  }

  indexed = { nodes, index };
  return index;
}

/** Shared empties, so a caller comparing by identity is not handed a new one. */
const NO_NODES: ResourceNode[] = [];
const NO_RECTS: Blocker[] = [];

export function nodesOn(nodes: readonly ResourceNode[], area: AreaId): ResourceNode[] {
  return indexOf(nodes).byArea.get(area) ?? NO_NODES;
}

export function nodeAt(
  nodes: readonly ResourceNode[],
  area: AreaId,
  x: number,
  y: number,
): ResourceNode | null {
  return indexOf(nodes).byTile.get(tileKey(area, x, y)) ?? null;
}

export function nodeById(nodes: readonly ResourceNode[], id: string): ResourceNode | null {
  return nodes.find((node) => node.id === id) ?? null;
}

/**
 * The rectangles a walker cannot pass through, on one map.
 *
 * A tile each, because a node stands on a tile: the sprite for a mature tree
 * is three times that tall and you walk behind its canopy, which is the whole
 * reason collision is measured here rather than off the drawing.
 */
export function solidNodeRects(nodes: readonly ResourceNode[], area: AreaId): Blocker[] {
  return indexOf(nodes).solid.get(area) ?? NO_RECTS;
}

// --- the deterministic draw --------------------------------------------------

/**
 * A 32-bit hash of whatever it is handed. FNV-1a, the same one the herd uses.
 *
 * Every random-looking thing in this file comes out of here, because the
 * reducer is not allowed `Math.random()`: two clients simulating the same farm
 * have to wake up to the same morning, with nothing sent over the wire to say
 * what grew overnight. A hash of the state is how that is free rather than
 * expensive.
 */
function hash(...parts: Array<string | number>): number {
  let value = 0x811c9dc5;
  const text = parts.join(':');
  for (let i = 0; i < text.length; i += 1) {
    value ^= text.charCodeAt(i);
    value = Math.imul(value, 0x01000193);
  }
  return value >>> 0;
}

/** The same hash as a fraction of 1, which is what a probability wants. */
function roll(...parts: Array<string | number>): number {
  return hash(...parts) / 0x100000000;
}

/** An integer in [min, max], drawn from the same hash. */
function between(min: number, max: number, ...parts: Array<string | number>): number {
  return min + (hash(...parts) % (max - min + 1));
}

// --- what a node gives -------------------------------------------------------

export interface NodeDrop {
  item: ItemId;
  count: number;
}

export interface NodeYield {
  drops: NodeDrop[];
  /** Straight into the silo rather than the satchel. Grass, and only grass. */
  hay: number;
}

const NOTHING: NodeYield = { drops: [], hay: 0 };

/**
 * What falls out when a node does.
 *
 * Seeded from the node's own id and the day, so the amount is fixed the moment
 * the node exists: two clients felling the same tree get the same twelve
 * planks, and re-running the same morning gives the same answer twice.
 */
export function yieldOf(node: ResourceNode, day: number, seed: number): NodeYield {
  const draw = `${seed}:${node.id}:${day}`;

  switch (node.kind) {
    case 'tree': {
      if ((node.stage ?? 0) < TREE_MATURE_STAGE) return { drops: [{ item: 'wood', count: 1 }], hay: 0 };
      const drops: NodeDrop[] = [{ item: 'wood', count: between(8, 12, draw, 'wood') }];
      if (roll(draw, 'sap') < 0.35) drops.push({ item: 'sap', count: 1 });
      return { drops, hay: 0 };
    }
    case 'stump':
      return { drops: [{ item: 'hardwood', count: 20 }], hay: 0 };
    case 'rock':
      return { drops: [{ item: 'stone', count: between(1, 2, draw, 'stone') }], hay: 0 };
    case 'boulder': {
      const drops: NodeDrop[] = [{ item: 'stone', count: 5 }];
      if (roll(draw, 'coal') < 0.3) drops.push({ item: 'coal', count: 1 });
      return { drops, hay: 0 };
    }
    case 'weed':
      return { drops: [{ item: 'fiber', count: 1 }], hay: 0 };
    case 'grass':
      return { drops: [], hay: 1 };
    case 'forage':
      return node.item ? { drops: [{ item: node.item, count: 1 }], hay: 0 } : NOTHING;
  }
}

// --- working a node ----------------------------------------------------------

/** Where a tool sits on the ladder, for comparing one against a requirement. */
const TIER_ORDER: Record<ToolTier, number> = { basic: 0, copper: 1, steel: 2, gold: 3 };

export function tierAtLeast(tier: ToolTier, required: ToolTier): boolean {
  return TIER_ORDER[tier] >= TIER_ORDER[required];
}

export type NodeCheck =
  | { ok: true }
  /** `tooWeak` is set only when the right tool was used and was not good enough. */
  | { ok: false; reason: string; tooWeak: ToolTier | null };

/**
 * Whether what is in hand can work this node.
 *
 * Two refusals, and telling them apart is the point: "you need an axe" sends a
 * player to the hotbar, and "you need a copper axe" sends them to the
 * blacksmith. Swinging ten times at something that was never going to break is
 * an interface failure rather than a difficulty.
 */
export function checkTool(node: ResourceNode, held: ItemId | null): NodeCheck {
  const def = NODE_DEFS[node.kind];
  if (def.tool === null) return { ok: true };

  const item = held ? ITEMS[held] : undefined;
  if (!item || item.tool !== def.tool) {
    return {
      ok: false,
      tooWeak: null,
      reason: `${def.label} cần ${toolName(def.tool)}. Thứ trong tay bạn không làm gì được nó.`,
    };
  }
  if (!tierAtLeast(item.tier ?? 'basic', node.requires)) {
    return {
      ok: false,
      tooWeak: node.requires,
      reason: `${def.label} cứng hơn ${item.label.toLowerCase()} của bạn. Cần ít nhất ${TIER_NAMES[node.requires]}.`,
    };
  }
  return { ok: true };
}

const TOOL_NAMES: Record<Tool, string> = {
  hoe: 'cái cuốc',
  can: 'bình tưới',
  basket: 'cái giỏ',
  axe: 'cái rìu',
  pickaxe: 'cái cuốc chim',
  scythe: 'cái liềm',
  // Nothing standing on the ground is worked with a rod, so this name is only
  // ever read by a refusal — "cần cái rìu, không phải cần câu". It is spelled
  // out anyway rather than left to a fallback, because the record is exhaustive
  // on purpose: a seventh implement should be a compile error here, not a
  // sentence with `undefined` in the middle of it.
  rod: 'cần câu',
  sword: 'thanh kiếm',
};

function toolName(tool: Tool): string {
  return TOOL_NAMES[tool];
}

/** What a tier is called when a refusal has to name one. */
const TIER_NAMES: Record<ToolTier, string> = {
  basic: 'nông cụ thường',
  copper: 'đồ đồng',
  steel: 'đồ thép',
  gold: 'đồ vàng',
};

export interface NodeSweepResult {
  /** Every node that changed. A `null` node is one that fell. */
  changed: Array<{ id: string; node: ResourceNode | null }>;
  inventory: Inventory;
  hay: number;
  /** The whole sweep, with the tool's tier factor already applied. */
  energyCost: number;
  /** Nodes that took a hit and stayed up, for the shake. */
  hit: Array<{ id: string; kind: NodeKind }>;
  /** Nodes that came down, and what they gave. */
  cleared: Array<{ id: string; kind: NodeKind; drops: NodeDrop[] }>;
  /** Set when a swing bounced off something too hard, for the cursor to learn from. */
  tooWeak: ToolTier | null;
  message: string;
}

/**
 * Works every node a swing covers.
 *
 * The shape of `applySweep` in `farming.ts`, and deliberately so — a steel axe
 * covers 3x3 exactly as a steel hoe does, and the two ought to feel like one
 * mechanic rather than two. Energy is charged per node actually struck and the
 * tier's factor applied to the total, for the reason set out there: applied per
 * node it would round away to nothing.
 *
 * The one rule with teeth: **the felling blow is refused when there is nowhere
 * to put what falls**. Dropping it on the ground would need world items,
 * pickup and despawn rules; losing it silently is worse than either. So the
 * tree stays up with its last point of health, exactly where you left it.
 */
export function workNodes(
  targets: readonly ResourceNode[],
  held: ItemId | null,
  inventory: Inventory,
  hay: number,
  hayCapacity: number,
  day: number,
  seed: number,
  energyFactor = 1,
): NodeSweepResult {
  const changed: NodeSweepResult['changed'] = [];
  const hit: NodeSweepResult['hit'] = [];
  const cleared: NodeSweepResult['cleared'] = [];
  let carried = inventory;
  let silo = hay;
  let rawEnergy = 0;
  let tooWeak: ToolTier | null = null;
  let firstRefusal = '';
  let wasted = false;

  for (const node of targets) {
    const check = checkTool(node, held);
    if (!check.ok) {
      if (!firstRefusal) firstRefusal = check.reason;
      if (check.tooWeak && !tooWeak) tooWeak = check.tooWeak;
      continue;
    }

    rawEnergy += NODE_DEFS[node.kind].energy;

    if (node.health > 1) {
      changed.push({ id: node.id, node: { ...node, health: node.health - 1 } });
      hit.push({ id: node.id, kind: node.kind });
      continue;
    }

    const gained = yieldOf(node, day, seed);

    // Everything, or nothing. A tree that gave eight planks and swallowed four
    // is the kind of loss a player only notices at the shop counter.
    let packed: Inventory | null = carried;
    for (const drop of gained.drops) {
      packed = packed && addItem(packed, drop.item, drop.count);
    }
    if (!packed) {
      if (!firstRefusal) {
        firstRefusal = `Túi của bạn không còn chỗ cho thứ ${NODE_DEFS[node.kind].label.toLowerCase()} này cho.`;
      }
      // The swing never happened, so it costs nothing either.
      rawEnergy -= NODE_DEFS[node.kind].energy;
      continue;
    }

    carried = packed;
    // Hay that will not fit is hay that is gone. Said out loud, because grass
    // vanishing into a full silo without a word reads as a bug.
    if (gained.hay > 0) {
      if (silo + gained.hay > hayCapacity) wasted = true;
      silo = Math.min(hayCapacity, silo + gained.hay);
    }

    changed.push({ id: node.id, node: null });
    cleared.push({ id: node.id, kind: node.kind, drops: gained.drops });
  }

  return {
    changed,
    inventory: carried,
    hay: silo,
    energyCost: Math.round(rawEnergy * energyFactor),
    hit,
    cleared,
    tooWeak,
    message: describeSweep(cleared, hit, wasted, firstRefusal),
  };
}

function describeSweep(
  cleared: NodeSweepResult['cleared'],
  hit: NodeSweepResult['hit'],
  wasted: boolean,
  refusal: string,
): string {
  if (cleared.length === 0 && hit.length === 0) return refusal || 'Chỗ đó chẳng có gì để dọn.';

  if (cleared.length > 0) {
    const gathered = new Map<ItemId, number>();
    for (const fell of cleared) {
      for (const drop of fell.drops) {
        gathered.set(drop.item, (gathered.get(drop.item) ?? 0) + drop.count);
      }
    }
    const haul = [...gathered]
      .map(([item, count]) => `${count} ${itemDef(item).label.toLowerCase()}`)
      .join(', ');
    // Grass gives nothing to carry, so a scythe sweep has no haul to read out.
    const what = haul === '' ? 'Cỏ đã vào kho' : `Bạn thu được ${haul}`;
    return wasted ? `${what}. Kho cỏ đã đầy, phần còn lại bỏ phí.` : `${what}.`;
  }

  return hit.length > 1 ? `${hit.length} nhát trúng đích.` : 'Nó lung lay, nhưng chưa đổ.';
}

// --- where a node may stand --------------------------------------------------

/**
 * Everything overnight growth has to see before it puts something down.
 *
 * Handed in rather than read from a store, because this runs inside the
 * reducer and the reducer is pure — and because the server and an offline
 * browser have to be looking at the same farm when they ask.
 */
export interface SpawnWorld {
  plots: Record<string, PlotState>;
  buildings: readonly Building[];
  /**
   * What players have put down. Spec 11's, and the reason the paths in its
   * recipe table are a mechanic rather than decoration: nothing grows back on
   * a tile somebody has laid something on.
   */
  placeables: readonly Placeable[];
}

/** How much room a doorway and a spawn point are given, in tiles. */
const KEEP_CLEAR_TILES = 1;

function overlapsTile(rect: { x: number; y: number; width: number; height: number }, x: number, y: number) {
  const left = x * TILE_SIZE;
  const top = y * TILE_SIZE;
  return (
    rect.x < left + TILE_SIZE &&
    left < rect.x + rect.width &&
    rect.y < top + TILE_SIZE &&
    top < rect.y + rect.height
  );
}

/**
 * Whether a node may stand on a tile.
 *
 * Every refusal here is one somebody would otherwise have filed as a bug: a
 * boulder in a doorway strands a player, a tree on a tilled bed eats a
 * planting, and a bush on a spawn point greets a new farmhand with a wall.
 * Asked the same way for the first morning's layout and for every night after
 * it, so there is one answer rather than two that drift.
 */
export function canHoldNode(
  area: AreaId,
  x: number,
  y: number,
  kind: NodeKind,
  world: SpawnWorld,
  taken: ReadonlySet<string>,
): boolean {
  if (taken.has(tileKey(area, x, y))) return false;
  // Nothing grows under a roof. Asked here rather than in each spawner, because
  // the spawners walk every area and fall through to a default: the first
  // morning's hedgerow roll is the village's, and it planted forage on the
  // farmhouse floorboards the day there was a floor.
  if (areaMap(area).indoor) return false;

  const tile = tileAt(area, x, y);
  if (!tile || tile.solid || tile.kind === 'water') return false;
  // Nothing solid on a path. It is the one guarantee that a route across a map
  // stays a route, however many nights of growth land on either side of it.
  if (NODE_DEFS[kind].solid && tile.kind === 'path') return false;

  // Worked ground belongs to whoever worked it. A wild plot is fair game, and
  // is exactly what makes the first week about clearing the field.
  const plot = world.plots[plotKey(area, x, y)];
  if (plot && plot.stage !== 'wild') return false;

  if (buildingAt(buildingsOn(world.buildings, area), x, y)) return false;
  // A laid path, a chest, a sprinkler: the tile is spoken for. This is the
  // whole mechanical content of the three path recipes — a route you cleared
  // once stays cleared, however many nights of bramble land on either side.
  if (groundIsClaimed(world.placeables, area, x, y)) return false;

  const map = areaMap(area);
  for (const prop of map.props) {
    if (overlapsTile(prop, x, y)) return false;
  }
  for (const portal of map.portals) {
    if (
      overlapsTile(
        {
          x: portal.x - KEEP_CLEAR_TILES * TILE_SIZE,
          y: portal.y - KEEP_CLEAR_TILES * TILE_SIZE,
          width: portal.width + KEEP_CLEAR_TILES * TILE_SIZE * 2,
          height: portal.height + KEEP_CLEAR_TILES * TILE_SIZE * 2,
        },
        x,
        y,
      )
    ) {
      return false;
    }
  }
  for (const spawn of map.spawns) {
    const gap = Math.max(
      Math.abs(spawn.x / TILE_SIZE - 0.5 - x),
      Math.abs(spawn.y / TILE_SIZE - 0.5 - y),
    );
    if (gap <= KEEP_CLEAR_TILES) return false;
  }

  return true;
}

/** Builds a node with the health and the id it should have. */
export function createNode(
  id: string,
  kind: NodeKind,
  area: AreaId,
  x: number,
  y: number,
  extra: { stage?: number | null; item?: ItemId | null } = {},
): ResourceNode {
  const stage = extra.stage ?? (kind === 'tree' ? TREE_MATURE_STAGE : null);
  return {
    id,
    kind,
    area,
    x,
    y,
    health: healthOf(kind, stage),
    requires: NODE_DEFS[kind].requires,
    stage,
    item: extra.item ?? null,
  };
}

// --- the first morning -------------------------------------------------------

/**
 * How much of the farm's open grass starts under weeds.
 *
 * Tuned by looking at it rather than by arithmetic. At 0.16 the farm read as
 * scrubland rather than as a field that had been left a season — every second
 * tile had something on it, and the eye could not find the shape of the fields
 * underneath. A tenth leaves the field legible and still gives the first week
 * a morning's work.
 */
const STARTING_WEED_DENSITY = 0.1;
/**
 * And under grass, which is what the scythe and the silo are for.
 *
 * Deliberately well under `MAX_GRASS_CLUMPS`, or the farm would start at its
 * own ceiling and grass would never spread at all — which is the one thing a
 * player who has just built a silo needs it to do.
 */
const STARTING_GRASS_DENSITY = 0.035;
/** And under rocks, which is the only stone the farm will ever grow. */
const STARTING_ROCK_DENSITY = 0.045;
/** The stumps the last tenant left. Rare, because each one wants a copper axe. */
const STARTING_STUMP_DENSITY = 0.012;

/** How thick the woods are, which is most of why walking there is worth it. */
/**
 * How thick the woods are.
 *
 * Judged by walking through it rather than by arithmetic. At 0.3 the
 * canopies overlapped into a single mass of green with no ground visible
 * between them, which is a wall rather than a wood — and a wood you cannot
 * see a path through is a wood nobody enjoys clearing.
 */
const FOREST_TREE_DENSITY = 0.22;
const FOREST_BOULDER_DENSITY = 0.03;
/** Matched to `FORAGE_TARGET` below, so the wood does not thin out after day one. */
const FOREST_FORAGE_DENSITY = 0.008;

/**
 * Where the world starts.
 *
 * The farm begins overgrown, which is the second thing this spec fixes and the
 * quieter one: the field used to start swept clean, so the first week had no
 * sense of reclaiming anything. Stardew hands you a plot under brambles and
 * half the pleasure of the first season is watching it come out from under
 * them.
 *
 * Deterministic from the seed, like everything else here, so a screenshot of
 * day one is reproducible and a test can say exactly what is standing where.
 */
export function seedNodes(world: SpawnWorld, season: Season, seed: number): ResourceNode[] {
  const nodes: ResourceNode[] = [];
  const taken = new Set<string>();
  let next = 1;

  const place = (
    area: AreaId,
    x: number,
    y: number,
    kind: NodeKind,
    extra?: { stage?: number | null; item?: ItemId | null },
  ) => {
    if (!canHoldNode(area, x, y, kind, world, taken)) return;
    nodes.push(createNode(`n${next}`, kind, area, x, y, extra));
    taken.add(tileKey(area, x, y));
    next += 1;
  };

  for (const area of AREA_IDS) {
    const map = areaMap(area);
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        const draw = roll(seed, 'seed', area, x, y);

        if (area === 'forest') {
          let floor = 0;
          if (draw < (floor += FOREST_TREE_DENSITY)) place(area, x, y, 'tree');
          else if (draw < (floor += FOREST_BOULDER_DENSITY)) place(area, x, y, 'boulder');
          else if (draw < (floor += 0.05)) place(area, x, y, 'grass');
          // The woods carry forage from the first morning. Walking there on
          // day one and finding only firewood would be a long way to go for
          // something the farm's own hedgerow already had.
          else if (draw < floor + FOREST_FORAGE_DENSITY) {
            place(area, x, y, 'forage', { item: forageFor(season, seed, area, x, y) });
          }
          continue;
        }

        if (area === BUILDING_AREA) {
          let floor = 0;
          if (draw < (floor += STARTING_WEED_DENSITY)) place(area, x, y, 'weed');
          else if (draw < (floor += STARTING_GRASS_DENSITY)) place(area, x, y, 'grass');
          else if (draw < (floor += STARTING_ROCK_DENSITY)) place(area, x, y, 'rock');
          else if (draw < floor + STARTING_STUMP_DENSITY) place(area, x, y, 'stump');
          continue;
        }

        // The village. Nothing to clear there — it is somebody else's ground —
        // but the hedgerows have things in them, which is Juniper's whole point.
        //
        // Named rather than fallen through to, since spec 15: the phố is paved
        // and somebody else's too, and berries between the bricks are not a
        // hedgerow.
        if (area !== 'village') continue;
        if (draw < 0.012) place(area, x, y, 'forage', { item: forageFor(season, seed, area, x, y) });
      }
    }
  }

  return nodes;
}

function forageFor(season: Season, seed: number, ...parts: Array<string | number>): ItemId {
  const options = FORAGE_BY_SEASON[season];
  return options[hash(seed, 'forage', ...parts) % options.length];
}

// --- every morning after -----------------------------------------------------

/**
 * The ceilings, and why every one of them has to exist.
 *
 * Growth without a cap is not "the land reclaims itself", it is a farm that
 * becomes four hundred sprites of bramble and then eight hundred. Measured
 * over a simulated month with no ceilings at all: the weeds tripled and the
 * wood put on ninety trees, which is a world nobody would want to come back
 * to after a fortnight away.
 *
 * So each kind gets a number, and each number is roughly what the world starts
 * with. A farm left alone goes back to about the state you found it in — which
 * is the feeling this is for — and never past it.
 */
export const MAX_GRASS_CLUMPS = 60;
export const MAX_WEED_CLUMPS = 200;

/** How many trees each map will carry. The farm is a farm, not a wood. */
const MAX_TREES: Partial<Record<AreaId, number>> = { farm: 16, forest: 210 };

/** How likely one clump of grass is to put out another overnight. */
const GRASS_SPREAD_CHANCE = 0.22;

/** How likely a mature tree is to drop a seed that takes, per night. */
const SAPLING_CHANCE = 0.05;

/** How likely a tree that is still growing is to move up a stage. */
const TREE_GROWTH_CHANCE = 0.2;

/** How much of the farm's open ground grows weeds overnight, by season. */
const WEED_CHANCE: Record<Season, number> = {
  Spring: 0.012,
  Summer: 0.006,
  Autumn: 0.006,
  Winter: 0.001,
};

/** How much forage each map carries at once. */
const FORAGE_TARGET: Partial<Record<AreaId, number>> = { village: 5, forest: 12 };

/** How likely a missing piece of forage is to come back, per night. */
const FORAGE_RETURN_CHANCE = 0.5;

export interface NodeDayResult {
  nodes: ResourceNode[];
  /** How many came up overnight, for the morning summary. */
  spawned: number;
  /** How many the turning season took, which in winter is every blade of grass. */
  cleared: number;
}

/**
 * What the night did to the ground.
 *
 * Run from `startNewDay`, after the crops and before the summary, and every
 * draw in it comes out of `spawnSeed` and the date — so two clients wake up to
 * the same morning and nothing has to be sent to say so.
 *
 * The one thing that deliberately does **not** happen here is stone. A farm
 * that regrew its own rocks for ever would make the mine in spec 13 pointless
 * before it was written, so the rocks the farm starts with are all the rocks
 * it will ever have, and everything after that comes out of the ground.
 */
export function startNodeDay(
  nodes: readonly ResourceNode[],
  world: SpawnWorld,
  season: Season,
  day: number,
  seed: number,
): NodeDayResult {
  const turning = dayOfSeason(day) === 1;
  let kept: ResourceNode[] = [...nodes];
  let cleared = 0;

  // A season takes its forage with it: an autumn mushroom standing in the snow
  // is a world that forgot to change. Winter takes the grass as well, which is
  // exactly why the silo is worth 900g and why it wants filling in autumn.
  if (turning) {
    const before = kept.length;
    kept = kept.filter((node) => {
      if (node.kind === 'forage') return false;
      if (node.kind === 'grass' && season === 'Winter') return false;
      return true;
    });
    cleared = before - kept.length;
  }

  const taken = new Set(kept.map((node) => tileKey(node.area, node.x, node.y)));
  let nextId = Number(nextNodeId(kept).slice(1));
  const grown: ResourceNode[] = [];

  const place = (
    area: AreaId,
    x: number,
    y: number,
    kind: NodeKind,
    extra?: { stage?: number | null; item?: ItemId | null },
  ): boolean => {
    if (!canHoldNode(area, x, y, kind, world, taken)) return false;
    grown.push(createNode(`n${nextId}`, kind, area, x, y, extra));
    taken.add(tileKey(area, x, y));
    nextId += 1;
    return true;
  };

  // Trees put on a stage. Done first so a tree that matured tonight can seed
  // tomorrow rather than the same night it grew up.
  const standing = kept.map((node) => {
    if (node.kind !== 'tree' || node.stage === null || node.stage >= TREE_MATURE_STAGE) return node;
    if (roll(seed, 'grow', day, node.id) >= TREE_GROWTH_CHANCE) return node;
    const stage = node.stage + 1;
    return { ...node, stage, health: healthOf('tree', stage) };
  });

  // Grass spreads, one tile per clump and only into the four neighbours, so it
  // creeps along a fence line the way real grass does rather than blooming
  // outwards in a circle.
  let clumps = standing.filter((node) => node.kind === 'grass' && node.area === BUILDING_AREA).length;
  for (const node of standing) {
    if (clumps >= MAX_GRASS_CLUMPS) break;
    if (node.kind !== 'grass' || node.area !== BUILDING_AREA) continue;
    if (roll(seed, 'spread', day, node.id) >= GRASS_SPREAD_CHANCE) continue;
    const side = hash(seed, 'side', day, node.id) % 4;
    const dx = side === 0 ? 1 : side === 1 ? -1 : 0;
    const dy = side === 2 ? 1 : side === 3 ? -1 : 0;
    if (place(node.area, node.x + dx, node.y + dy, 'grass')) clumps += 1;
  }

  // Saplings, from whatever is mature. On the farm as well as in the woods:
  // a farm that is left alone should start to go back to scrub, and a player
  // who wants it clear has a reason to walk it every few days. Capped per map,
  // because a farm that grew its own forest would eventually be a farm with
  // nowhere left to put a barn.
  const trees = new Map<AreaId, number>();
  for (const node of standing) {
    if (node.kind !== 'tree') continue;
    trees.set(node.area, (trees.get(node.area) ?? 0) + 1);
  }
  for (const node of standing) {
    if (node.kind !== 'tree' || node.stage !== TREE_MATURE_STAGE) continue;
    if ((trees.get(node.area) ?? 0) >= (MAX_TREES[node.area] ?? 0)) continue;
    if (roll(seed, 'seedling', day, node.id) >= SAPLING_CHANCE) continue;
    const spread = hash(seed, 'drop', day, node.id);
    const dx = ((spread & 0xff) % 5) - 2;
    const dy = (((spread >>> 8) & 0xff) % 5) - 2;
    if (place(node.area, node.x + dx, node.y + dy, 'tree', { stage: 0 })) {
      trees.set(node.area, (trees.get(node.area) ?? 0) + 1);
    }
  }

  // Weeds, on the farm's own open ground. This is what makes a field that has
  // been left alone for a fortnight look like it.
  let weeds = standing.filter((node) => node.kind === 'weed').length;
  const farmMap = areaMap(BUILDING_AREA);
  for (let y = 0; y < farmMap.height && weeds < MAX_WEED_CLUMPS; y += 1) {
    for (let x = 0; x < farmMap.width && weeds < MAX_WEED_CLUMPS; x += 1) {
      if (roll(seed, 'weed', day, x, y) >= WEED_CHANCE[season]) continue;
      if (place(BUILDING_AREA, x, y, 'weed')) weeds += 1;
    }
  }

  // Forage, back up to what each map carries. Walked in a fixed order so the
  // same morning always fills the same tiles.
  for (const [area, target] of Object.entries(FORAGE_TARGET) as Array<[AreaId, number]>) {
    let held = standing.filter((node) => node.kind === 'forage' && node.area === area).length;
    held += grown.filter((node) => node.kind === 'forage' && node.area === area).length;
    if (held >= target) continue;

    const map = areaMap(area);
    for (let y = 0; y < map.height && held < target; y += 1) {
      for (let x = 0; x < map.width && held < target; x += 1) {
        if (roll(seed, 'forage', day, area, x, y) >= 0.02) continue;
        if (roll(seed, 'return', day, area, x, y) >= FORAGE_RETURN_CHANCE) continue;
        if (place(area, x, y, 'forage', { item: forageFor(season, seed, area, x, y, day) })) {
          held += 1;
        }
      }
    }
  }

  // Always a fresh array, even on a night that changed nothing. There is no
  // identity short-circuit worth having here: this runs once at dawn rather
  // than once a frame, and the renderer's own `nodes === drawnNodes` check
  // wants to re-diff after a roll-over anyway.
  return { nodes: [...standing, ...grown], spawned: grown.length, cleared };
}
