import type { GameEvent } from '../state/intents';
import { MAX_ANIMAL_NAME, MAX_HAY_PURCHASE, isAnimalKind, type AnimalKind } from '../systems/animals';
import { isBuildingKind, type BuildingKind } from '../systems/buildings';
import { MAX_CRAFT, isRecipeId } from '../systems/crafting';
import { CHEST_SLOTS, isPlaceableKind } from '../systems/placeables';
import { HOTBAR_SIZE, INVENTORY_SIZE } from '../systems/inventory';
import { isItemId, type ItemId, type PlaceableKind } from '../systems/items';
import { ELEVATOR_EVERY, MAX_DEPTH } from '../systems/mine';
import { MAX_BUY } from '../systems/shop';
import type { FarmState, PlayerId } from '../state/types';
import { MAX_AREA_TILES, type AreaId, type Direction } from '../world/areas';

/** Message channels. Kept short because they travel on every packet. */
export const MSG = {
  /** client -> server: one thing the player wants to do. */
  command: 'c',
  /** server -> client: the whole farm, after anything but movement changed. */
  sync: 's',
  /** server -> client: player positions, every simulation tick. */
  moves: 'm',
  /** server -> client: the in-game clock advanced. */
  clock: 'k',
  /** server -> client: things that happened, for sounds and messages. */
  events: 'e',
  /** server -> client: which player this connection controls. */
  welcome: 'w',
  /** server -> client: who the player is and which world they are in. */
  identity: 'id',
} as const;

/**
 * What a client is allowed to send.
 *
 * Note what is missing: `playerId`. The server stamps every command with the
 * session it arrived on, so a client cannot act as another player — it is not
 * a rule the server enforces, it is a value the client never gets to supply.
 *
 * Also missing: `deltaMs`. A client that chose its own timestep could walk as
 * fast as it liked, so movement is expressed as an input direction and the
 * server advances it using the server's own clock.
 */
export type ClientCommand =
  | { type: 'move'; dx: number; dy: number }
  /** Put a hotbar slot in hand. */
  | { type: 'selectSlot'; slot: number }
  /** Rearrange the grid: merge two like stacks, or swap two unlike ones. */
  | { type: 'moveStack'; from: number; to: number }
  /** Halve a stack into an empty slot. */
  | { type: 'splitStack'; from: number; to: number }
  /**
   * Act on a tile.
   *
   * The target is optional and absent means "the tile I am facing", which is
   * exactly what the keyboard has always sent. A mouse names the tile instead.
   * Either way the reducer decides whether the player can reach it: a target
   * that survives this parser is well-formed, not permitted.
   */
  | { type: 'act'; target?: { x: number; y: number } }
  /**
   * Turn in for the night, or get back up. Nothing to validate beyond the
   * type: whether the player is actually standing at a bed is the reducer's
   * decision, and it is not a value a client gets to supply.
   */
  | { type: 'sleep' }
  /**
   * Buy seeds from the market stall.
   *
   * Note what is not here: a price, and a confirmation that the panel is open.
   * The stall's prices come from the server's own tables, and whether the
   * player is standing at the stall is checked against the server's own idea
   * of where they are.
   */
  | { type: 'buy'; item: ItemId; count: number }
  | { type: 'closePanel' }
  /**
   * Leave a tool with the blacksmith.
   *
   * Which tool, and nothing else. Not what it becomes, not what it costs, not
   * how long it takes and not whether the player is standing at the anvil —
   * all four come from the server's own tables and the server's own idea of
   * where this player is.
   */
  | { type: 'upgradeTool'; item: ItemId }
  | { type: 'collectTool' }
  /**
   * Propose a spot for a building.
   *
   * The most trust-sensitive command in the protocol: it writes a solid
   * rectangle into shared state. Shape is checked here, and everything else —
   * the ground, the props, the crops, the other buildings, the wallet and
   * which map the sender is standing on — is re-derived in the reducer.
   */
  | { type: 'placeBuilding'; kind: BuildingKind; x: number; y: number }
  /**
   * Buy an animal.
   *
   * Three fields, and only one of them is really the client's to choose. The
   * kind and the house are proposals the reducer re-checks against the farm's
   * own buildings and wallet; the name is the one value that genuinely
   * originates here, so it is the one checked for shape — a length, because a
   * name is otherwise allowed to be whatever somebody wants to call a goat,
   * and an unbounded string off the wire is a way to fill a database.
   */
  | { type: 'buyAnimal'; kind: AnimalKind; home: string; name: string }
  | { type: 'sellAnimal'; animalId: string }
  | { type: 'buyHay'; count: number }
  /** The three chores, each naming one animal. */
  | { type: 'petAnimal'; animalId: string }
  | { type: 'collectProduce'; animalId: string }
  | { type: 'feedAnimal'; animalId: string }
  | { type: 'toggleDoor'; buildingId: string }
  /**
   * Make something.
   *
   * Which recipe and how many, and nothing at all about what it costs. The
   * ingredients, whether this player has learned it and whether there is room
   * for the result all come from the server's own tables and the server's own
   * satchel.
   */
  | { type: 'craft'; recipe: ItemId; count: number }
  /**
   * Put a crafted thing down.
   *
   * As trust-sensitive as `placeBuilding`, and checked the same way: shape
   * here, and everything else — the ground, the crops, the props, the
   * doorways, the reach and whether the satchel holds one — in the reducer.
   */
  | { type: 'placeItem'; item: PlaceableKind; x: number; y: number }
  | { type: 'pickUpItem'; x: number; y: number }
  /**
   * Move a stack between the satchel and a chest.
   *
   * The chest is named by id and nothing else. Whether it exists, whether it
   * is a chest, and whether the sender is standing near enough to have their
   * hands in it are all answered against the server's own farm — which is the
   * check that stops a modified client emptying a box from two maps away.
   */
  | {
      type: 'chestMoveStack';
      chestId: string;
      from: { side: 'player' | 'chest'; slot: number };
      to: { side: 'player' | 'chest'; slot: number };
    }
  | { type: 'chestStow'; chestId: string }
  /** Feed the machine what is in hand, or take out what it finished. */
  | { type: 'loadMachine'; machineId: string }
  | { type: 'collectMachine'; machineId: string }
  /**
   * Throw a line at a water tile.
   *
   * A tile and nothing else. Which fish is on the end of it is drawn by the
   * server from the farm's own seed the instant the line lands — so there is
   * nothing here for a modified client to ask for, and nothing it can learn
   * until the thing bites.
   */
  | { type: 'cast'; target: { x: number; y: number } }
  /**
   * The reel, held or let go.
   *
   * A button state rather than a position, and this is the command the whole
   * of spec 12's hard paragraph is about. A client that sent where its square
   * was on the bar would be a client that could put it wherever the fish is,
   * which is the fishing minigame's version of sending your own coordinates.
   * So the server runs the bar and this says only whether the key is down.
   */
  | { type: 'reel'; down: boolean }
  | { type: 'cancelCast' }
  /**
   * Swing the sword in hand, at a tile or the way the player faces.
   *
   * No damage, no monster, no hit: which monsters are in the fan, how much
   * health they lose and what they drop are all the server's, measured from
   * where the server thinks this player is standing.
   */
  | { type: 'attack'; target?: { x: number; y: number } }
  /** Down the ladder underfoot, or into the mine from its mouth. Nothing to say. */
  | { type: 'descend' }
  /** Ride to an elevator stop. Whether it has been opened is the reducer's answer. */
  | { type: 'useElevator'; depth: number }
  | { type: 'exitMine' };

export interface MoveUpdate {
  id: PlayerId;
  /** Sent with every position: a player who walked through a door is not
   *  simply somewhere else, they are somewhere else on a different map. */
  area: AreaId;
  x: number;
  y: number;
  facing: Direction;
}

export interface WelcomeMessage {
  playerId: PlayerId;
  farm: FarmState;
}

export interface ClockMessage {
  time: FarmState['time'];
  season: FarmState['season'];
  weather: FarmState['weather'];
  /**
   * The awake monsters. They move on the clock step, and resending the whole
   * farm every 1.2s for as long as somebody is underground would be the cost
   * this compact frame exists to avoid. Empty whenever the mine is.
   */
  monsters: FarmState['monsters'];
}

export interface EventsMessage {
  events: GameEvent[];
}

export interface IdentityMessage {
  /** Present this next time to be recognised as the same player. */
  token: string;
  /** The world's invite code, for bringing somebody else in. */
  code: string;
  playerId: PlayerId;
}

/** One axis of a movement input, as sent by a well-behaved client. */
function isAxis(value: unknown): value is number {
  return value === -1 || value === 0 || value === 1;
}

/**
 * A slot index that actually addresses a slot.
 *
 * Checked as a whole number inside the array rather than merely as a number:
 * this is the likeliest place in the protocol for a malformed client to reach
 * past the end of an array, and `-1`, `1.5` and `999` are all numbers.
 */
function isSlotIndex(value: unknown, size: number): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < size;
}

/** A tile coordinate that could name a tile on some map in this build. */
function isTileCoord(value: unknown): value is number {
  return (
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < MAX_AREA_TILES
  );
}

/**
 * The most an id off the wire may be.
 *
 * Ids in this game are `a3` and `b12`, generated by the reducer and never by a
 * client — so the only thing to check here is that this one is a short
 * non-empty string. Whether it names anything is the reducer's answer, asked
 * against the farm's own herd and its own buildings.
 */
const MAX_ID_LENGTH = 64;

function isId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH;
}

/**
 * The optional tile target on `act`.
 *
 * Three outcomes, and the difference between the last two is the point:
 * `undefined` is an absent target, which legitimately means the faced tile;
 * `null` is a present but malformed one, which must drop the whole command.
 * Coercing a bad target into a keyboard swing would let a fuzzer act by
 * sending nonsense.
 */
function parseTarget(value: unknown): { x: number; y: number } | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'object' || value === null) return null;
  const point = value as Record<string, unknown>;
  if (!isTileCoord(point.x) || !isTileCoord(point.y)) return null;
  return { x: point.x, y: point.y };
}

/**
 * One end of a chest drag: which side, and which slot of it.
 *
 * The slot is bounded by the larger of the two containers rather than by the
 * one it names, because which chest this is has not been looked up yet — the
 * reducer does that, and `moveStack` shrugs at an index that addresses
 * nothing. What this stops is the unbounded integer, which is the part a
 * parser can actually answer.
 */
const MAX_CONTAINER_SLOTS = Math.max(INVENTORY_SIZE, CHEST_SLOTS['big-chest']);

function parseChestRef(value: unknown): { side: 'player' | 'chest'; slot: number } | null {
  if (typeof value !== 'object' || value === null) return null;
  const ref = value as Record<string, unknown>;
  if (ref.side !== 'player' && ref.side !== 'chest') return null;
  if (!isSlotIndex(ref.slot, MAX_CONTAINER_SLOTS)) return null;
  return { side: ref.side, slot: ref.slot };
}

/**
 * Validates a command off the wire.
 *
 * Everything a client sends is untrusted, including from our own build: a
 * modified client, a replayed packet, or a fuzzer all arrive here. Unknown or
 * malformed commands are dropped rather than coerced into something valid.
 */
export function parseClientCommand(raw: unknown): ClientCommand | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const command = raw as Record<string, unknown>;

  switch (command.type) {
    case 'move':
      if (!isAxis(command.dx) || !isAxis(command.dy)) return null;
      return { type: 'move', dx: command.dx, dy: command.dy };

    case 'selectSlot':
      // The hotbar, not the whole grid: only what is in reach can be held.
      if (!isSlotIndex(command.slot, HOTBAR_SIZE)) return null;
      return { type: 'selectSlot', slot: command.slot };

    case 'moveStack':
      if (!isSlotIndex(command.from, INVENTORY_SIZE)) return null;
      if (!isSlotIndex(command.to, INVENTORY_SIZE)) return null;
      return { type: 'moveStack', from: command.from, to: command.to };

    case 'splitStack':
      if (!isSlotIndex(command.from, INVENTORY_SIZE)) return null;
      if (!isSlotIndex(command.to, INVENTORY_SIZE)) return null;
      return { type: 'splitStack', from: command.from, to: command.to };

    case 'act': {
      const target = parseTarget(command.target);
      if (target === null) return null;
      return target ? { type: 'act', target } : { type: 'act' };
    }

    case 'sleep':
      return { type: 'sleep' };

    case 'buy':
      // Checked as an item this build knows about, and as a whole number the
      // stall could plausibly be asked for. Whether it is in stock this season
      // and whether the wallet covers it are the reducer's answers, not this
      // one — but `-1` and `1e9` are shaped wrong, and stop here.
      if (!isItemId(command.item)) return null;
      if (typeof command.count !== 'number' || !Number.isInteger(command.count)) return null;
      if (command.count < 1 || command.count > MAX_BUY) return null;
      return { type: 'buy', item: command.item, count: command.count };

    case 'closePanel':
      return { type: 'closePanel' };

    case 'upgradeTool':
      // An item this build knows about. Whether it is a tool, whether it has
      // a rung above it, whether the satchel holds one and whether the wallet
      // covers the work are all the reducer's answers — but a string that
      // names nothing stops here.
      if (!isItemId(command.item)) return null;
      return { type: 'upgradeTool', item: command.item };

    case 'collectTool':
      return { type: 'collectTool' };

    case 'placeBuilding':
      if (!isBuildingKind(command.kind)) return null;
      if (!isTileCoord(command.x) || !isTileCoord(command.y)) return null;
      return { type: 'placeBuilding', kind: command.kind, x: command.x, y: command.y };

    case 'buyAnimal': {
      if (!isAnimalKind(command.kind) || !isId(command.home)) return null;
      if (typeof command.name !== 'string') return null;
      const name = command.name.trim();
      // Trimmed here rather than in the reducer, so the value the reducer
      // stores and the value this length was measured against are the same one.
      if (name.length === 0 || name.length > MAX_ANIMAL_NAME) return null;
      return { type: 'buyAnimal', kind: command.kind, home: command.home, name };
    }

    case 'sellAnimal':
      if (!isId(command.animalId)) return null;
      return { type: 'sellAnimal', animalId: command.animalId };

    case 'buyHay':
      if (typeof command.count !== 'number' || !Number.isInteger(command.count)) return null;
      if (command.count < 1 || command.count > MAX_HAY_PURCHASE) return null;
      return { type: 'buyHay', count: command.count };

    case 'petAnimal':
      if (!isId(command.animalId)) return null;
      return { type: 'petAnimal', animalId: command.animalId };

    case 'collectProduce':
      if (!isId(command.animalId)) return null;
      return { type: 'collectProduce', animalId: command.animalId };

    case 'feedAnimal':
      if (!isId(command.animalId)) return null;
      return { type: 'feedAnimal', animalId: command.animalId };

    case 'toggleDoor':
      if (!isId(command.buildingId)) return null;
      return { type: 'toggleDoor', buildingId: command.buildingId };

    case 'craft':
      // A recipe this build has. Whether this player has learned it, and
      // whether the satchel covers it, are the reducer's answers — but a
      // string that names nothing stops here.
      if (!isRecipeId(command.recipe)) return null;
      if (typeof command.count !== 'number' || !Number.isInteger(command.count)) return null;
      if (command.count < 1 || command.count > MAX_CRAFT) return null;
      return { type: 'craft', recipe: command.recipe, count: command.count };

    case 'placeItem':
      if (!isPlaceableKind(command.item)) return null;
      if (!isTileCoord(command.x) || !isTileCoord(command.y)) return null;
      return { type: 'placeItem', item: command.item, x: command.x, y: command.y };

    case 'pickUpItem':
      if (!isTileCoord(command.x) || !isTileCoord(command.y)) return null;
      return { type: 'pickUpItem', x: command.x, y: command.y };

    case 'chestMoveStack': {
      if (!isId(command.chestId)) return null;
      const from = parseChestRef(command.from);
      const to = parseChestRef(command.to);
      if (!from || !to) return null;
      return { type: 'chestMoveStack', chestId: command.chestId, from, to };
    }

    case 'chestStow':
      if (!isId(command.chestId)) return null;
      return { type: 'chestStow', chestId: command.chestId };

    case 'loadMachine':
      if (!isId(command.machineId)) return null;
      return { type: 'loadMachine', machineId: command.machineId };

    case 'cast': {
      // The same three outcomes `act` has, minus the middle one: a cast with
      // no target is not a cast, so an absent target is malformed here where
      // it is legitimate there.
      const target = parseTarget(command.target);
      if (!target) return null;
      return { type: 'cast', target };
    }

    case 'reel':
      // Nothing to check but the shape. Whether this player has a line in the
      // water, and whether the phase it is in is one where a held key means
      // anything, are both the reducer's answers against the reducer's own
      // cast — and a `reel` that arrives at the wrong moment is dropped there
      // without a word rather than refused here.
      if (typeof command.down !== 'boolean') return null;
      return { type: 'reel', down: command.down };

    case 'cancelCast':
      return { type: 'cancelCast' };

    case 'attack': {
      const target = parseTarget(command.target);
      if (target === null) return null;
      return target ? { type: 'attack', target } : { type: 'attack' };
    }

    case 'descend':
      return { type: 'descend' };

    case 'useElevator':
      // A stop that could exist. Whether this farm has opened it, and whether
      // the sender is standing at an elevator, are the reducer's answers.
      if (typeof command.depth !== 'number' || !Number.isInteger(command.depth)) return null;
      if (command.depth < ELEVATOR_EVERY || command.depth > MAX_DEPTH || command.depth % ELEVATOR_EVERY !== 0) {
        return null;
      }
      return { type: 'useElevator', depth: command.depth };

    case 'exitMine':
      return { type: 'exitMine' };

    case 'collectMachine':
      if (!isId(command.machineId)) return null;
      return { type: 'collectMachine', machineId: command.machineId };

    default:
      return null;
  }
}

export function toMoveUpdates(farm: FarmState): MoveUpdate[] {
  return Object.values(farm.players).map((player) => ({
    id: player.id,
    area: player.area,
    x: Math.round(player.x * 100) / 100,
    y: Math.round(player.y * 100) / 100,
    facing: player.facing,
  }));
}

/** Everything the server can send, tagged by channel. */
export type ServerFrame =
  | { t: typeof MSG.identity; d: IdentityMessage }
  | { t: typeof MSG.welcome; d: WelcomeMessage }
  | { t: typeof MSG.sync; d: FarmState }
  | { t: typeof MSG.moves; d: MoveUpdate[] }
  | { t: typeof MSG.clock; d: ClockMessage }
  | { t: typeof MSG.events; d: EventsMessage };

/** What a client sends: always a command, on the one inbound channel. */
export interface ClientFrame {
  t: typeof MSG.command;
  d: ClientCommand;
}

export function encodeFrame(frame: ServerFrame | ClientFrame): string {
  return JSON.stringify(frame);
}

/**
 * Decodes a frame off the wire without trusting it. Returns null for anything
 * that is not parseable JSON carrying a channel tag, so a malformed or hostile
 * packet is dropped at the edge rather than part-way through handling.
 */
export function decodeFrame(raw: string): { t: string; d: unknown } | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) return null;
  const frame = parsed as Record<string, unknown>;
  if (typeof frame.t !== 'string') return null;
  return { t: frame.t, d: frame.d };
}
