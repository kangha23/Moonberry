import type { AnimalKind } from '../systems/animals';
import type { BuildingKind } from '../systems/buildings';
import type { GiftReaction, NpcId } from '../npcs/definitions';
import type { PortraitMood } from '../npcs/types';
import type { FarmAction } from '../systems/farming';
import type { CropId, ItemId, ProduceGrade, ToolTier } from '../systems/items';
import type { MachineKind, PlaceableKind } from '../systems/items';
import type { RecipeUnlock } from '../systems/crafting';
import type { MonsterKind } from '../systems/mine';
import type { NodeKind } from '../systems/resources';
import type { Season } from '../systems/time';
import type { AreaId, Point } from '../world/areas';
import type { FarmState, PanelId, PlayerId } from './types';

/**
 * Everything a client is allowed to ask the farm to do.
 *
 * Intents are requests, not commands: the reducer validates each one and may
 * reject it. Once the server exists these travel over the wire unchanged, so
 * they must stay plain JSON.
 */
export type Intent =
  | { type: 'player/join'; playerId: PlayerId; name: string }
  | { type: 'player/leave'; playerId: PlayerId }
  | { type: 'player/move'; playerId: PlayerId; dx: number; dy: number; deltaMs: number }
  /** Put a hotbar slot in hand. What is in it is what acting uses. */
  | { type: 'player/selectSlot'; playerId: PlayerId; slot: number }
  /** Rearranging: merge two stacks of the same thing, or swap them. */
  | { type: 'player/moveStack'; playerId: PlayerId; from: number; to: number }
  /** Halve a stack into an empty slot. */
  | { type: 'player/splitStack'; playerId: PlayerId; from: number; to: number }
  /**
   * Act on a tile: the one named, or the one the player faces when none is.
   *
   * The target is where the mouse comes in, and the reducer checks it against
   * the player's own position. Range-checking only on the client would hand
   * anyone with devtools the ability to farm the whole map from the gate.
   */
  | { type: 'player/act'; playerId: PlayerId; target?: Point }
  /** A toggle: a player who changed their mind can get back up. */
  | { type: 'player/sleep'; playerId: PlayerId }
  /**
   * Buy seeds from the market stall.
   *
   * Whether the panel is open is not part of this, and neither is where the
   * player is standing: the reducer checks the stall is in reach, because a
   * client that only sends this while the panel is open is a client we are
   * choosing to believe.
   */
  | { type: 'shop/buy'; playerId: PlayerId; item: ItemId; count: number }
  /** Shuts whichever place-bound panel this player has open. */
  | { type: 'panel/close'; playerId: PlayerId }
  /**
   * Leave a tool with the blacksmith.
   *
   * Which tool, and nothing else: what it becomes, what it costs and how long
   * it takes all come from the server's own tables, and whether the player is
   * standing at the anvil is measured against where the server thinks they are.
   */
  | { type: 'player/upgradeTool'; playerId: PlayerId; item: ItemId }
  /** Pick the finished tool back up. Refused before the morning it is ready. */
  | { type: 'player/collectTool'; playerId: PlayerId }
  /**
   * Put a building up at a spot on the farm.
   *
   * A proposal, emphatically: the reducer checks the footprint is on the farm,
   * clear of water, props, other buildings and crops, and that the wallet
   * covers it. The translucent footprint on the client is a courtesy.
   */
  | { type: 'player/placeBuilding'; playerId: PlayerId; kind: BuildingKind; x: number; y: number }
  /**
   * Buy an animal from the rancher.
   *
   * Which kind, which house, and what to call it. Not the price, not whether
   * the house is finished, and not whether there is room in it: all three come
   * from the server's own tables, measured against the server's own farm.
   */
  | { type: 'player/buyAnimal'; playerId: PlayerId; kind: AnimalKind; home: string; name: string }
  /** Sell one back, for half. The only way out of a coop full of ducks. */
  | { type: 'player/sellAnimal'; playerId: PlayerId; animalId: string }
  /** Buy hay. Refused when there is no silo to put it in. */
  | { type: 'player/buyHay'; playerId: PlayerId; count: number }
  /**
   * The three things you can do to an animal, one intent each.
   *
   * Named rather than folded into `player/act`, because the panel needs to ask
   * for one specific animal by id: a coop holds eight and "the one I am facing"
   * is not a sentence a list of rows can say.
   */
  | { type: 'player/petAnimal'; playerId: PlayerId; animalId: string }
  | { type: 'player/collectProduce'; playerId: PlayerId; animalId: string }
  | { type: 'player/feedAnimal'; playerId: PlayerId; animalId: string }
  /** Prop the coop door open, or shut it. Shared: one door, one state. */
  | { type: 'animals/toggleDoor'; playerId: PlayerId; buildingId: string }
  /**
   * Make something out of what is in the satchel.
   *
   * Which recipe and how many, and nothing else. What it costs, whether this
   * player has learned it and whether there is room for the result are all
   * answered from the server's own tables against the server's own satchel.
   */
  | { type: 'player/craft'; playerId: PlayerId; recipe: ItemId; count: number }
  /**
   * Put a crafted thing down on a tile.
   *
   * The same shape of proposal `placeBuilding` is, and re-checked the same
   * way: the reducer decides whether the tile is on a map this player is
   * standing on, is within reach, is clear of crops, nodes, buildings, props
   * and other placeables, and whether the satchel actually holds one.
   */
  | { type: 'player/placeItem'; playerId: PlayerId; item: PlaceableKind; x: number; y: number }
  /** Take it back up. A chest with anything in it refuses. */
  | { type: 'player/pickUpItem'; playerId: PlayerId; x: number; y: number }
  /**
   * Move a stack between the satchel and an open chest, or within either.
   *
   * One intent for all four directions rather than four, because it is one
   * operation: `from` and `to` each name a side and a slot, and the reducer
   * does the same merge-or-swap `moveStack` has always done. Splitting it into
   * `takeFromChest`/`putInChest`/... would be four code paths that have to
   * agree about stacking rules, which is three chances to disagree.
   */
  | {
      type: 'chest/moveStack';
      playerId: PlayerId;
      chestId: string;
      from: { side: 'player' | 'chest'; slot: number };
      to: { side: 'player' | 'chest'; slot: number };
    }
  /** The "dump it all in" button: every stack the chest already has a slot for. */
  | { type: 'chest/stow'; playerId: PlayerId; chestId: string }
  /**
   * Throw a line at a water tile.
   *
   * A proposal like every other: the reducer checks that the tile is water on
   * the map this player is standing on, that it is within the same 1.5 tiles
   * everything else is, that a rod is in hand and that there is energy for it.
   * Which fish comes up is decided here and now, from the farm's own seed —
   * never sent, and never asked for.
   */
  | { type: 'player/cast'; playerId: PlayerId; target: Point }
  /**
   * The reel, held or let go.
   *
   * A button state rather than a position, for exactly the reason `player/move`
   * is a direction rather than a coordinate: a client that sent where its
   * square was would be a client that could put it wherever the fish is. The
   * server runs the bar and the client sends `down`.
   */
  | { type: 'player/reel'; playerId: PlayerId; down: boolean }
  /** Give up on a cast. Costs the energy already spent, and refunds nothing. */
  | { type: 'player/cancelCast'; playerId: PlayerId }
  /** Feed a machine whatever is in hand. */
  | { type: 'machine/load'; playerId: PlayerId; machineId: string }
  /** Take out what it finished. */
  | { type: 'machine/collect'; playerId: PlayerId; machineId: string }
  /**
   * Swing the sword in hand, in a fan towards `target` (a tile) or the way
   * the player faces. Ignored outright when what is in hand is not a sword.
   */
  | { type: 'player/attack'; playerId: PlayerId; target?: Point }
  /** Down the ladder the player is standing on, or into the mine from its mouth. */
  | { type: 'player/descend'; playerId: PlayerId }
  /** Ride to an elevator floor. Refused past `deepestFloor`. */
  | { type: 'player/useElevator'; playerId: PlayerId; depth: number }
  /** Climb out of the mine, back to the farm. */
  | { type: 'player/exitMine'; playerId: PlayerId }
  | { type: 'world/tick'; deltaMs: number };

/**
 * Things that happened as a result of an intent. The renderer turns these into
 * sprites, sounds, and toasts; the reducer itself never touches presentation.
 */
export type GameEvent =
  | { kind: 'message'; playerId: PlayerId; text: string }
  /**
   * A plot changed. `action` is the swing that did it, and is absent for the
   * overnight roll-over, which nobody swung at. Presentation needs it: one
   * event covers tilling, watering, planting and harvesting, and those are
   * four different sounds and four different particles.
   */
  | { kind: 'plotChanged'; key: string; action?: FarmAction }
  | { kind: 'harvested'; playerId: PlayerId; crop: CropId }
  | { kind: 'sold'; playerId: PlayerId; coins: number; count: number }
  | { kind: 'questRewarded'; playerId: PlayerId; coins: number }
  /** A new morning. `grown` is how many plots moved on overnight. */
  | { kind: 'dayStarted'; day: number; grown: number }
  /**
   * The season turned and took the crops that could not live through it.
   *
   * `crops` is deduplicated and carried alongside the count so the morning
   * summary can name what was lost. A number on its own would make the panel
   * say "6 crops withered", which is the sentence that reads as a bug.
   */
  | { kind: 'cropsWithered'; count: number; season: Season; crops: CropId[] }
  /**
   * Somebody said something. The line is chosen in the reducer, because which
   * line it is depends on hearts, season, weather and what they are doing —
   * all of which are state, and none of which the renderer should be reading.
   * `mood` is the face the dialogue box draws, chosen with the line for the
   * same reason.
   */
  | { kind: 'npcSpoke'; npc: NpcId; playerId: PlayerId; line: string; mood: PortraitMood }
  /**
   * A gift changed hands. `heartsNow` is carried so the renderer can pop a
   * heart without recomputing one from points it would have to go and fetch.
   */
  | {
      kind: 'giftGiven';
      npc: NpcId;
      playerId: PlayerId;
      item: ItemId;
      reaction: GiftReaction;
      heartsNow: number;
      /** True only when this gift crossed a heart, which is worth a fanfare. */
      heartGained: boolean;
      birthday: boolean;
      /**
       * What they said on taking it, and the face they said it with — the
       * reaction's face, not the line's. A gift does not also emit `npcSpoke`
       * (two blips over one exchange), so the box opens off this instead.
       */
      line: string;
      mood: PortraitMood;
    }
  /** A place-bound panel opened or closed. `panel` is null when it closed. */
  | { kind: 'panelChanged'; playerId: PlayerId; panel: PanelId | null }
  /** A tool went in for work, and the morning it comes back out. */
  | { kind: 'upgradeOrdered'; playerId: PlayerId; item: ItemId; into: ItemId; readyOnDay: number }
  /** The blacksmith finished overnight. Said once, on the morning it is done. */
  | { kind: 'upgradeReady'; playerId: PlayerId; item: ItemId }
  | { kind: 'upgradeCollected'; playerId: PlayerId; item: ItemId }
  /** Ground broken. Still a scaffold until `readyOnDay`. */
  | { kind: 'buildingPlaced'; playerId: PlayerId; id: string; building: BuildingKind; readyOnDay: number }
  /** The roof went on overnight. */
  | { kind: 'buildingFinished'; id: string; building: BuildingKind }
  | { kind: 'bought'; playerId: PlayerId; item: ItemId; count: number; coins: number }
  /** A stroke landed. The heart over the animal is the renderer's business. */
  | { kind: 'animalPetted'; playerId: PlayerId; animalId: string; animal: AnimalKind }
  /**
   * Something came out of the coop. `grade` rides along so the renderer can
   * say how good it was without going back to the herd to work it out — and
   * so a fine egg can sound different from an ordinary one later.
   */
  | {
      kind: 'produceCollected';
      playerId: PlayerId;
      animalId: string;
      item: ItemId;
      grade: ProduceGrade;
    }
  | { kind: 'animalBought'; playerId: PlayerId; animalId: string; animal: AnimalKind; coins: number }
  | { kind: 'animalSold'; playerId: PlayerId; animal: AnimalKind; coins: number }
  /** Bales into the silo. Not a `bought`, because hay is not an item. */
  | { kind: 'hayBought'; playerId: PlayerId; count: number; coins: number }
  | { kind: 'animalFed'; playerId: PlayerId; animalId: string }
  /** The coop door swung. Shared, because everybody's herd just changed plans. */
  | { kind: 'doorToggled'; buildingId: string; open: boolean }
  /**
   * How many went to bed hungry. Once per morning and never per animal: eight
   * separate lines saying the same thing is a wall of text, and one number
   * with a picture beside it is the morning summary doing its job.
   */
  | { kind: 'animalsHungry'; count: number }
  /**
   * A swing landed on something standing and it stayed up.
   *
   * Carries the kind rather than the node, because the renderer wants a shake
   * and a sound and neither of those needs the health left. A node that fell
   * sends `nodeCleared` instead, never both.
   */
  | { kind: 'nodeHit'; playerId: PlayerId; id: string; node: NodeKind }
  /** It came down. `drops` is what went into the satchel, for the flying icons. */
  | {
      kind: 'nodeCleared';
      playerId: PlayerId;
      id: string;
      node: NodeKind;
      drops: Array<{ item: ItemId; count: number }>;
    }
  /**
   * The tool bounced off.
   *
   * The most important of the three, and the reason it is an event rather than
   * only a sentence: hitting a boulder ten times with a copper pick and being
   * told nothing is an interface failure, not a difficulty. The renderer greys
   * the cursor on anything this tier cannot touch, so the rule is visible
   * before it is enforced.
   */
  | { kind: 'toolTooWeak'; playerId: PlayerId; node: NodeKind; requires: ToolTier }
  /** What came up overnight, counted once for the morning panel. */
  | { kind: 'nodesGrew'; spawned: number; cleared: number }
  | { kind: 'sleepChanged'; playerId: PlayerId; asleep: boolean }
  | { kind: 'exhausted'; playerId: PlayerId }
  | { kind: 'collapsed'; coinsLost: number }
  | { kind: 'playerJoined'; playerId: PlayerId }
  | { kind: 'playerLeft'; playerId: PlayerId }
  | { kind: 'areaChanged'; playerId: PlayerId; area: AreaId }
  /** Something was made. `made` is how many came out, not how many presses. */
  | { kind: 'crafted'; playerId: PlayerId; item: ItemId; made: number }
  /** Something was put down, or taken back up. */
  | { kind: 'itemPlaced'; playerId: PlayerId; id: string; item: PlaceableKind; x: number; y: number }
  | { kind: 'itemPickedUp'; playerId: PlayerId; item: PlaceableKind }
  | {
      kind: 'machineLoaded';
      playerId: PlayerId;
      machineId: string;
      machine: MachineKind;
      input: ItemId;
      output: ItemId;
      readyOnDay: number;
    }
  /**
   * A machine finished overnight.
   *
   * Emitted once, on the morning it is done, so the renderer can put the
   * bubble up over it. Shared rather than addressed to a player, because a
   * machine belongs to the farm and everybody wants to see the bubble.
   */
  | { kind: 'machineReady'; machineId: string; machine: MachineKind; output: ItemId }
  | { kind: 'machineCollected'; playerId: PlayerId; machineId: string; item: ItemId }
  /**
   * A recipe arrived. `from` is the condition that produced it, so the toast
   * can say who gave it to you rather than that one simply appeared.
   */
  | { kind: 'recipeLearned'; playerId: PlayerId; recipe: ItemId; from: RecipeUnlock }
  /** A line went out. `target` is the tile the float landed on. */
  | { kind: 'cast'; playerId: PlayerId; area: AreaId; target: Point }
  /**
   * Something took it.
   *
   * The most important event in spec 12 and the reason the exclamation mark
   * and the sound both hang off one thing: a player who misses this has
   * missed the whole system, so it must be impossible to miss by accident.
   */
  | { kind: 'bite'; playerId: PlayerId }
  /**
   * It is in the basket. `fish` and `size` ride along so the card can name
   * what was caught without going back to state that has already been cleared.
   */
  | { kind: 'fishCaught'; playerId: PlayerId; fish: ItemId; size: number; difficulty: number }
  /**
   * It is not.
   *
   * `struck` tells the two failures apart: false is a bite nobody answered,
   * true is a fish that won the bar. They are different mistakes and deserve
   * different sentences — one is "you were not looking", the other is "it was
   * stronger than your rod", and conflating them teaches neither.
   */
  | { kind: 'fishEscaped'; playerId: PlayerId; fish: ItemId; struck: boolean }
  /** How many plots the sprinklers watered before the night's growth. */
  | { kind: 'sprinklersRan'; watered: number }
  /** A monster landed a strike. */
  | { kind: 'damaged'; playerId: PlayerId; amount: number }
  /**
   * A monster died to this player's sword. `monster` rather than the spec's
   * second `kind`, which would collide with the discriminant. `drops` is what
   * reached the satchel.
   */
  | {
      kind: 'monsterKilled';
      playerId: PlayerId;
      id: string;
      monster: MonsterKind;
      drops: Array<{ item: ItemId; count: number }>;
    }
  | { kind: 'descended'; playerId: PlayerId; depth: number }
  /** Health ran out. Their day is over; nobody else's is. */
  | { kind: 'faint'; playerId: PlayerId; coinsLost: number }
  /** Somebody reached a floor nobody on the farm had reached before. */
  | { kind: 'newDepthRecord'; depth: number }
  /** The whole farm was swapped out: start a new farm now, a server resync later. */
  | { kind: 'farmReplaced' };

export interface ApplyResult {
  state: FarmState;
  events: GameEvent[];
}
