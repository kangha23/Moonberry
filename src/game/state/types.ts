import type { Animal } from '../systems/animals';
import type { FishingState } from '../systems/fishing';
import type { Monster } from '../systems/mine';
import type { Building } from '../systems/buildings';
import type { Placeable } from '../systems/placeables';
import type { Relationships } from '../npcs/relationships';
import type { NpcActor } from '../npcs/schedule';
import type { PlotState } from '../systems/farming';
import type { Inventory } from '../systems/inventory';
import type { ItemId } from '../systems/items';
import type { QuestState } from '../systems/quest';
import type { ResourceNode } from '../systems/resources';
import type { Season, TimeState, Weather } from '../systems/time';
import type { AreaId, Direction } from '../world/areas';

export type PlayerId = string;

export const MAX_PLAYERS = 4;

/**
 * Stamina on the first morning, matching Stardew's, which is tuned to roughly
 * a field's worth of work. A starting point to playtest, not a constant to
 * defend.
 */
export const STARTING_MAX_ENERGY = 270;

/** How fast a player on empty walks, as a fraction of normal speed. */
export const EXHAUSTED_SPEED_SCALE = 0.5;

/**
 * Health on the first morning, and every morning after. Separate from energy
 * on purpose (spec 13): energy drains evenly over a day of work, health drops
 * in lumps in the mine, and merging them would let ten rocks and one slime
 * kill a farmhand.
 */
export const STARTING_MAX_HEALTH = 100;

/**
 * What collapsing at 02:00 costs: a tenth of the shared wallet, capped, and
 * nothing else. Never crops or items — in a shared world the person who
 * stayed up is not the only one who would pay for them.
 */
export const COLLAPSE_COIN_SHARE = 0.1;
export const COLLAPSE_COIN_CAP = 500;

/**
 * How long the blacksmith keeps a tool.
 *
 * Two days is what makes an upgrade a decision rather than a purchase: you
 * give up watering at scale precisely when you were about to need it, and the
 * question at the counter is whether the field can spare the hoe this week.
 */
export const UPGRADE_DAYS = 2;

/**
 * A panel the world opened for a player, rather than one their browser did.
 *
 * The satchel lives in the browser, because it is yours wherever you stand.
 * These two are tied to a place: the server opens one when you act at the
 * counter and closes it the moment you walk away, so a client cannot keep a
 * shop open from the far side of the map and trade from there.
 *
 * One field rather than a boolean each, so "both panels are open at once" is
 * not a state that exists to be reached.
 */
export type PanelId = 'market' | 'workshop' | 'ranch' | 'chest';

/**
 * How many slots a chest panel shows per row, so the grid and the satchel
 * agree. Here rather than in CSS because the keyboard walk uses it too.
 */
export const CHEST_COLUMNS = 6;

/**
 * Which prop opens which panel. Read off the map, so moving one moves it.
 *
 * `chest` is deliberately absent: a chest is not a prop in a Tiled map, it is
 * something a player put down this morning and may pick up this afternoon. It
 * is place-bound all the same — see `panelSurvivesStep` in the reducer, which
 * is where the two kinds of place-bound panel get the one rule between them.
 */
export const PANEL_FOR_INTERACT: Record<string, PanelId> = {
  market: 'market',
  // Spec 15. The xôi cart is the market panel with a stock of its own; which
  // of the two a player is at is `stallAt`, read off the same prop.
  'xoi-stall': 'market',
  blacksmith: 'workshop',
  rancher: 'ranch',
};

export interface PlayerState {
  id: PlayerId;
  name: string;
  /** Which map the player is standing on. */
  area: AreaId;
  x: number;
  y: number;
  facing: Direction;
  /** Every slot this player carries; the first twelve are the hotbar. */
  inventory: Inventory;
  /** Which hotbar slot is in hand. Replaces the old tool and seed enums. */
  selectedSlot: number;
  /** Stamina left today. Spent working the land, restored by sleeping. */
  energy: number;
  /** The ceiling energy returns to each morning. */
  maxEnergy: number;
  /**
   * What the mine can take away. Only monsters touch it, and only in the mine;
   * at nought the player faints, which ends their day and nobody else's.
   * A fainted player is `asleep` with `health` 0 until the morning.
   */
  health: number;
  /** What health returns to each morning. */
  maxHealth: number;
  /** Minute of the day before which a monster's strike does nothing. */
  invulnerableUntil: number;
  /** Whether this player has turned in for the night; the day ends when all have. */
  asleep: boolean;
  /** Which place-bound panel is open for this player, if any. See `PanelId`. */
  panel: PanelId | null;
  /**
   * Which chest this player has open, when `panel` is `'chest'`.
   *
   * A second field rather than a richer `PanelId`, because it is the only
   * panel that needs to name a thing: the stall, the anvil and the pens are
   * each one of a kind on the map, and there can be thirty chests. Null
   * whenever `panel` is anything else, and cleared with it.
   */
  openChest: string | null;
  /**
   * Every recipe this player has learned.
   *
   * On the player rather than on the farm, and that is the one piece of spec
   * 11 that had to break the shared-world model — for exactly the reason
   * `relationships` does, one field below. A recipe is mostly unlocked by
   * hearts, hearts are a thing between two people, and a farmhand who woke up
   * knowing how to build a keg because somebody else befriended Maeve would be
   * strange. The ones with no condition are everybody's from the first
   * morning; see `STARTING_RECIPES`.
   */
  knownRecipes: ItemId[];
  /**
   * The tool this player has left with the blacksmith, and the morning it is
   * ready to collect.
   *
   * Against the player rather than against the farm, because it is one
   * person's hoe: in a shared world the tool came out of somebody's satchel
   * and has to go back into the same one. Null when nothing is in for work,
   * and only ever one thing at a time — the blacksmith has one anvil.
   */
  pendingUpgrade: { item: ItemId; readyOnDay: number } | null;
  /**
   * What this player has with each villager, and what they have spent on them
   * this week.
   *
   * Per player rather than per farm, which is the one place the shared-world
   * model is deliberately broken: a friendship is between two people, and one
   * farmhand's melons making everybody Tobias's friend would be strange. Empty
   * for somebody who has met nobody, which reads as nought hearts everywhere.
   */
  relationships: Relationships;
  /**
   * The cast this player has in the water, if any.
   *
   * Null for all but a few minutes of a day, which is why it is one nullable
   * field rather than a handful of nulls spread across `PlayerState`. On the
   * player rather than on the farm because a cast is one person's: two
   * farmhands on two banks are fighting two different fish, and neither
   * should be able to see, help with, or interrupt the other's.
   *
   * Never restored from a save — see `parsePlayer`. A half-played minigame
   * that survived a server restart would resume with a bite window that
   * expired hours ago.
   */
  fishing: FishingState | null;
  /**
   * Whether this player is connected right now.
   *
   * Membership outlives a session: leaving keeps the record, the inventory,
   * and the spot by the gate, so coming back tomorrow is coming back, not
   * starting over. Only presence is transient.
   */
  online: boolean;
}

/**
 * The complete authoritative game state for one farm.
 *
 * Everything here is plain JSON: no class instances, no Phaser objects, no
 * functions. That is what lets the identical reducer run on a server and the
 * whole state be serialized to the wire or to a database.
 *
 * Shared across players: coins, plots, quest, time, weather.
 * Per player: position, facing, inventory, and which slot is in hand.
 */
export interface FarmState {
  /** Incremented on every intent that changed anything. Used as the sync version. */
  revision: number;
  time: TimeState;
  season: Season;
  weather: Weather;
  /** Every farmable cell in the world, keyed by area and tile. */
  plots: Record<string, PlotState>;
  /** The farm's shared wallet. */
  coins: number;
  /**
   * What has been built on the farm, finished or still a scaffold.
   *
   * Here rather than in the map because it is per-world: `maps/*.json` is
   * static and identical in every world, and a building is neither. The cost
   * of that is real and worth stating — collision is no longer purely a map
   * property, so `isWalkable` has to be handed this list.
   */
  buildings: Building[];
  /**
   * Everything standing on the ground that a tool can take down: trees,
   * stumps, rocks, weeds, grass and whatever the season has put out.
   *
   * Here for exactly the reason the buildings are, and it is worth saying
   * twice because it is the decision this whole system turns on: `maps/*.json`
   * is static and identical in every world, and a stump somebody chopped last
   * Tuesday is neither. Nodes appear overnight, disappear under a swing, and
   * differ between two farms that were started five minutes apart.
   *
   * One flat array across every map rather than a record per area, because
   * everything that reads it either wants one tile (`nodeAt`) or one map
   * (`nodesOn`), and an array is what survives `JSON.stringify` on to the wire
   * without a shape to agree about.
   */
  nodes: ResourceNode[];
  /**
   * The world's seed for everything that grows back.
   *
   * Every overnight draw — which clump of grass spreads, which tree puts on a
   * stage, how many planks a felled tree gives — is a hash of this, the date,
   * and the thing being drawn for. Never `Math.random()`: the reducer is pure,
   * and two clients simulating the same farm have to wake up to the same
   * morning without a byte crossing the wire to say what grew.
   *
   * On the farm rather than in a module constant so that it is part of the
   * state the reducer is a function of — which is what makes "the same save
   * plus the same night is the same morning" a thing a test can assert.
   */
  spawnSeed: number;
  /**
   * The farm's own seed, drawn once when the farm is made and never changed.
   *
   * Separate from `spawnSeed`, which every farm shares by design so that day
   * one is reproducible; the mine should differ between two farms.
   */
  worldSeed: number;
  /**
   * `mineSeedFor(worldSeed, day)`, and so redrawn every morning: floor 5
   * today is not floor 5 tomorrow. Derived, but kept on the state so the
   * reducer and the renderer read the same number without recomputing it.
   */
  mineSeed: number;
  /** Deepest floor anyone on the farm has reached. Shared: one opens the way for all four. */
  deepestFloor: number;
  /**
   * The monsters on every mine floor an online player is standing on, and on
   * no other. Woken from the seed when a floor gains its first player, dropped
   * when it loses its last, so none of this is ever saved.
   */
  monsters: Monster[];
  /**
   * Where every villager is standing, simulated once by the server.
   *
   * Shared, unlike the relationships above: two players walking into the
   * village see Maeve in the same place, and there is only one Maeve to
   * simulate. What each of them *thinks* of her is the part that is private.
   */
  npcs: NpcActor[];
  /**
   * The herd, and what it eats.
   *
   * On the farm rather than on a player, which is the one place this differs
   * from `relationships` above and the reason both are worth stating: a
   * friendship is between two people, but a cow eats grass on shared ground
   * and whoever gets to the barn first does the milking. Two farmhands see the
   * same eight chickens standing in the same places.
   *
   * `hay` is a number rather than an `ItemStack` on purpose. Feeding ten cows
   * out of the satchel would be ten trips into the inventory screen, and a
   * permanent stack of grass would hold one of twenty-four slots for ever.
   * What the farm can keep is `240 x silos` — no silo, no hay.
   */
  animals: Animal[];
  hay: number;
  /**
   * Everything a player has built and put down: chests, machines, sprinklers,
   * fences, paths and torches.
   *
   * **One list, not four**, and that is the decision spec 11 warned itself
   * about. `buildings` and `nodes` above are already two arrays that answer
   * the same four questions in two slightly different ways; adding a third for
   * chests, a fourth for machines and a fifth for sprinklers is how that ends
   * badly. They share an array and a module — see `placeables.ts` — so a sixth
   * kind is a row in a table and nothing else.
   *
   * Note what this costs, stated as plainly as the two above state it:
   * collision is now a third thing `isWalkable` has to be handed, and a chest
   * full of produce is by some way the largest thing in a save file.
   */
  placeables: Placeable[];
  /** Farm-wide quest progress: any player can advance it, any player can claim it. */
  quest: QuestState;
  players: Record<PlayerId, PlayerState>;
  /** Real milliseconds banked toward the next in-game clock step. */
  clockMs: number;
}
