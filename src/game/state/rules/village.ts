/**
 * The villagers, as far as a player is concerned: who is standing near enough
 * to talk to, what they say, and what happens when you hand one a present.
 */
import { npcDef } from '../../npcs/definitions';
import { GIFT_MOOD, pickLine, type DialogueContext, type SpokenLine } from '../../npcs/dialogue';
import {
  REACTION_BLURB,
  giveGift,
  heartsWith,
  isBirthday,
  isGiftable,
  relationshipWith,
} from '../../npcs/relationships';
import { activityAt, type NpcActor } from '../../npcs/schedule';
import { removeItem, slotAt } from '../../systems/inventory';
import { itemDef, type ItemId } from '../../systems/items';
import { claimQuestReward } from '../../systems/quest';
import { isNear } from '../../world/areas';
import type { ApplyResult, GameEvent } from '../intents';
import type { FarmState, PlayerId, PlayerState } from '../types';
import { unchanged, say } from './common';
import { learnRecipes } from './placeables';

/**
 * The villager a player is standing next to, and how far away they are.
 *
 * The gap comes back with them because a counter and a villager can both be in
 * reach at once — Maeve works the forge yard — and the nearer of the two has to
 * win. That is the rule two props have always followed; this only extends it to
 * cover people.
 */
export function nearestNpc(state: FarmState, player: PlayerState): { actor: NpcActor; gap: number } | null {
  let best: { actor: NpcActor; gap: number } | null = null;
  for (const actor of state.npcs) {
    if (actor.area !== player.area) continue;
    if (!isNear(player, actor)) continue;
    const gap = Math.hypot(actor.x - player.x, actor.y - player.y);
    if (!best || gap < best.gap) best = { actor, gap };
  }
  return best;
}

/** Everything a line is allowed to depend on, gathered in one place. */
function dialogueContextFor(state: FarmState, player: PlayerState, actor: NpcActor): DialogueContext {
  const def = npcDef(actor.id);
  return {
    hearts: heartsWith(player.relationships, actor.id),
    season: state.season,
    weather: state.weather,
    day: state.time.day,
    birthday: isBirthday(def, state.season, state.time.day),
    questCompleted: state.quest.completed,
    questRewarded: state.quest.rewarded,
    activity: activityAt(def, state.season, state.weather, state.time),
  };
}

/** The line this villager has for this player right now, and its face. */
function speakLine(state: FarmState, playerId: PlayerId, actor: NpcActor): SpokenLine | null {
  const player = state.players[playerId];
  const def = npcDef(actor.id);
  if (!player) return null;
  return pickLine(def, dialogueContextFor(state, player, actor));
}

/**
 * Saying hello, as the two things that produces.
 *
 * Only the talking path emits `npcSpoke`. A gift makes its own sound and
 * carries the same line in its message, and firing both would put two blips
 * over one interaction.
 */
function speakEvents(state: FarmState, playerId: PlayerId, actor: NpcActor): GameEvent[] {
  const spoken = speakLine(state, playerId, actor);
  if (!spoken) return [];
  return [
    { kind: 'npcSpoke', npc: actor.id, playerId, line: spoken.line, mood: spoken.mood },
    say(playerId, `${npcDef(actor.id).name}: ${spoken.line}`),
  ];
}

/**
 * Talking.
 *
 * The quest rides along on this rather than on a villager's name: `questGiver`
 * is a flag in the definition, so the promise that adding a villager never
 * means touching this file survives the one villager who predates all of it.
 */
function applyTalk(state: FarmState, playerId: PlayerId, actor: NpcActor): ApplyResult {
  const events = speakEvents(state, playerId, actor);
  const def = npcDef(actor.id);
  if (!def.questGiver) return { state, events };

  const result = claimQuestReward(state.quest);
  if (!result.claimed) return { state, events };

  events.push(say(playerId, result.message), { kind: 'questRewarded', playerId, coins: result.reward });
  return {
    state: {
      ...state,
      revision: state.revision + 1,
      quest: result.quest,
      coins: state.coins + result.reward,
    },
    events,
  };
}

/**
 * Handing something over.
 *
 * A refusal still gets a line. The alternative — silence until tomorrow — makes
 * a villager who has already had their gift feel broken rather than finished
 * with, and the refusal itself has to change nothing at all: no points, no
 * allowance spent, and the item stays in the satchel.
 */
function applyGift(
  state: FarmState,
  playerId: PlayerId,
  actor: NpcActor,
  item: ItemId,
): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);

  const def = npcDef(actor.id);
  const before = relationshipWith(player.relationships, actor.id);
  const result = giveGift(before, def, item, state.season, state.time.day);
  if (!result.ok) {
    return { state, events: [say(playerId, result.reason), ...speakEvents(state, playerId, actor)] };
  }

  // Checked rather than assumed: `giveGift` has agreed the item is giftable,
  // but the satchel is the only thing that knows it is still in there.
  const inventory = removeItem(player.inventory, item, 1);
  if (!inventory) return { state, events: [say(playerId, 'Bạn không mang theo thứ đó.')] };

  const label = itemDef(item).label.toLowerCase();
  const spoken = speakLine(state, playerId, actor);
  const line = spoken?.line ?? '';
  const next: PlayerState = {
    ...player,
    inventory,
    relationships: { ...player.relationships, [actor.id]: result.relationship },
  };

  const events: GameEvent[] = [
    {
      kind: 'giftGiven',
      npc: actor.id,
      playerId,
      item,
      reaction: result.reaction,
      heartsNow: result.hearts,
      heartGained: result.heartGained,
      birthday: result.birthday,
      line,
      mood: GIFT_MOOD[result.reaction],
    },
    say(
      playerId,
      result.birthday
        ? `Bạn tặng ${def.name} ${label} — đúng ngày sinh nhật. ${def.name} ${REACTION_BLURB[result.reaction]}.`
        : `Bạn tặng ${def.name} ${label}. ${def.name} ${REACTION_BLURB[result.reaction]}.`,
    ),
    say(playerId, `${def.name}: ${line}`),
  ];

  // This is where spec 11 pays spec 07's debt, and it is two lines long.
  // Before this, a friendship bought dialogue and nothing else, so a player who
  // worked out that gifts were optional was right. Now four hearts with Maeve
  // is a keg. Asked here rather than only at dawn on purpose: a recipe that
  // turned up the next morning would leave the player unsure the gift had done
  // anything, and the whole point is that it visibly did.
  const taught = learnRecipes(next, state.time.day);
  events.push(...taught.events);

  return {
    state: {
      ...state,
      revision: state.revision + 1,
      players: { ...state.players, [playerId]: taught.player },
    },
    events,
  };
}

/**
 * Walking up to somebody.
 *
 * What is in hand decides which of the two this is, exactly as it decides what
 * a swing at a plot does: something giftable means a gift, and anything else —
 * a tool, an empty slot — means hello.
 */
export function applyNpcAct(state: FarmState, playerId: PlayerId, actor: NpcActor): ApplyResult {
  const player = state.players[playerId];
  if (!player) return unchanged(state);
  const held = slotAt(player.inventory, player.selectedSlot);
  return held && isGiftable(held.item)
    ? applyGift(state, playerId, actor, held.item)
    : applyTalk(state, playerId, actor);
}
