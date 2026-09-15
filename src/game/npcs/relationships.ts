import { ITEMS, type ItemId } from '../systems/items';
import { dayOfSeason, type Season } from '../systems/time';
import type { GiftReaction, NpcDef, NpcId } from './types';

/**
 * What one player thinks of one villager.
 *
 * Per player, not per farm. This is the one place the shared-world model
 * should not apply: a friendship is between two people, and one farmhand
 * handing over melons should not make everybody Tobias's friend. It therefore
 * hangs off `PlayerState`, and the save grows per player rather than per world.
 */
export interface Relationship {
  points: number;
  giftsThisWeek: number;
  giftedToday: boolean;
}

/**
 * Partial on purpose: a player who has never met anybody stores nothing, which
 * reads as zero hearts everywhere. Always read through `relationshipWith`.
 */
export type Relationships = Partial<Record<NpcId, Relationship>>;

/** Points to a heart. Hearts are a display of points, not a second number. */
export const POINTS_PER_HEART = 250;
export const MAX_HEARTS = 10;

/**
 * Two a week, one a day.
 *
 * Without the cap the optimal play is standing still handing over turnips,
 * which is neither interesting nor what friendship is. With it, the question
 * becomes which two, which is a question worth having.
 */
export const GIFTS_PER_WEEK = 2;
export const DAYS_PER_WEEK = 7;

/**
 * A gift on the day counts eight times.
 *
 * It is the single best reason to look at the calendar, which is otherwise a
 * number in the corner of the screen.
 */
export const BIRTHDAY_MULTIPLIER = 8;

export const REACTION_POINTS: Record<GiftReaction, number> = {
  loved: 80,
  liked: 45,
  neutral: 20,
  disliked: -20,
  hated: -40,
};

/** Ten hearts is the ceiling, and a run of bad gifts cannot dig below this. */
const MAX_POINTS = MAX_HEARTS * POINTS_PER_HEART;
const MIN_POINTS = -POINTS_PER_HEART;

export function emptyRelationship(): Relationship {
  return { points: 0, giftsThisWeek: 0, giftedToday: false };
}

/** What this player has with this villager, which may be nothing yet. */
export function relationshipWith(relationships: Relationships, npc: NpcId): Relationship {
  return relationships[npc] ?? emptyRelationship();
}

export function heartsFor(points: number): number {
  return Math.max(0, Math.min(MAX_HEARTS, Math.floor(points / POINTS_PER_HEART)));
}

/** Hearts this player has with this villager. Zero for somebody never met. */
export function heartsWith(relationships: Relationships, npc: NpcId): number {
  return heartsFor(relationshipWith(relationships, npc).points);
}

/**
 * Whether an item can be handed over at all.
 *
 * Tools cannot: giving away the hoe would be a way to lose it that no amount
 * of dialogue would make feel deliberate. Everything else — seed, produce,
 * timber — is fair game, and an unlisted item simply falls to the villager's
 * default reaction.
 */
export function isGiftable(item: ItemId): boolean {
  const def = ITEMS[item];
  return Boolean(def) && !def.tool;
}

export function reactionTo(def: NpcDef, item: ItemId): GiftReaction {
  return def.gifts[item] ?? def.defaultGiftReaction;
}

export function isBirthday(def: NpcDef, season: Season, day: number): boolean {
  return def.birthday.season === season && def.birthday.day === dayOfSeason(day);
}

/** The first day of a week, which is when the two-gift allowance comes back. */
export function isFirstDayOfWeek(day: number): boolean {
  return (day - 1) % DAYS_PER_WEEK === 0;
}

export type GiftResult =
  | { ok: false; reason: string }
  | {
      ok: true;
      relationship: Relationship;
      reaction: GiftReaction;
      /** What the gift was actually worth, birthday multiplier included. */
      points: number;
      hearts: number;
      /** True when a heart was crossed, which is what deserves a fanfare. */
      heartGained: boolean;
      birthday: boolean;
    };

/**
 * Hand something over.
 *
 * Pure, and it decides everything: whether the allowance is spent, what the
 * reaction is, what the multiplier does, and where that leaves the hearts. The
 * reducer's job is to take the item out of the satchel and store the result.
 */
export function giveGift(
  relationship: Relationship,
  def: NpcDef,
  item: ItemId,
  season: Season,
  day: number,
): GiftResult {
  if (!isGiftable(item)) {
    return { ok: false, reason: `${def.name} chẳng dùng thứ đó vào việc gì.` };
  }
  if (relationship.giftedToday) {
    return { ok: false, reason: `Hôm nay bạn đã tặng ${def.name} một món rồi.` };
  }
  if (relationship.giftsThisWeek >= GIFTS_PER_WEEK) {
    return { ok: false, reason: `Tuần này ${def.name} đã nhận hai món quà của bạn. Để tuần sau.` };
  }

  const birthday = isBirthday(def, season, day);
  const reaction = reactionTo(def, item);
  const points = REACTION_POINTS[reaction] * (birthday ? BIRTHDAY_MULTIPLIER : 1);
  const before = heartsFor(relationship.points);
  const next: Relationship = {
    points: Math.max(MIN_POINTS, Math.min(MAX_POINTS, relationship.points + points)),
    giftsThisWeek: relationship.giftsThisWeek + 1,
    giftedToday: true,
  };
  const hearts = heartsFor(next.points);

  return { ok: true, relationship: next, reaction, points, hearts, heartGained: hearts > before, birthday };
}

/**
 * The morning reset.
 *
 * The daily allowance always comes back; the weekly one comes back on the
 * first day of a week. Returns the same object when nothing needed changing,
 * so a player who has met nobody does not get a fresh record every dawn.
 */
export function startRelationshipDay(relationships: Relationships, day: number): Relationships {
  const weekly = isFirstDayOfWeek(day);
  const entries = Object.entries(relationships) as [NpcId, Relationship][];
  if (!entries.some(([, value]) => value.giftedToday || (weekly && value.giftsThisWeek > 0))) {
    return relationships;
  }

  const next: Relationships = {};
  for (const [id, value] of entries) {
    next[id] = {
      ...value,
      giftedToday: false,
      giftsThisWeek: weekly ? 0 : value.giftsThisWeek,
    };
  }
  return next;
}

/** How a reaction reads in the prompt bar. */
export const REACTION_BLURB: Record<GiftReaction, string> = {
  loved: 'sáng bừng cả mặt',
  liked: 'tỏ ra hài lòng',
  neutral: 'nhận lấy một cách lịch sự',
  disliked: 'cầm lấy mà chẳng mấy mặn mà',
  hated: 'nhìn món quà, rồi nhìn bạn',
};
