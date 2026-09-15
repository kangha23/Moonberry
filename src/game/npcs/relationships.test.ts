import { describe, expect, it } from 'vitest';
import { NPCS } from './definitions';
import {
  BIRTHDAY_MULTIPLIER,
  GIFTS_PER_WEEK,
  MAX_HEARTS,
  POINTS_PER_HEART,
  REACTION_POINTS,
  emptyRelationship,
  giveGift,
  heartsFor,
  heartsWith,
  isBirthday,
  isFirstDayOfWeek,
  isGiftable,
  reactionTo,
  relationshipWith,
  startRelationshipDay,
  type Relationship,
} from './relationships';
import { SEASONS, SEASON_DAYS, type Season } from '../systems/time';

const ROWAN = NPCS.rowan;

/** The absolute day that is a given day of a given season, in the first year. */
function dayIn(season: Season, dayOfSeason: number): number {
  return SEASONS.indexOf(season) * SEASON_DAYS + dayOfSeason;
}

/** A relationship with some history on it. */
function withPoints(points: number, extra: Partial<Relationship> = {}): Relationship {
  return { ...emptyRelationship(), points, ...extra };
}

describe('hearts, which are a display of points', () => {
  it('needs a full 250 points for the first one', () => {
    expect(heartsFor(0)).toBe(0);
    expect(heartsFor(POINTS_PER_HEART - 1)).toBe(0);
    expect(heartsFor(POINTS_PER_HEART)).toBe(1);
  });

  it('stops at ten however many points are behind it', () => {
    expect(heartsFor(POINTS_PER_HEART * MAX_HEARTS)).toBe(MAX_HEARTS);
    expect(heartsFor(POINTS_PER_HEART * 40)).toBe(MAX_HEARTS);
  });

  it('never goes below nought, however badly it has gone', () => {
    expect(heartsFor(-1)).toBe(0);
    expect(heartsFor(-10_000)).toBe(0);
  });

  it('reads nought for somebody who has never been met', () => {
    expect(heartsWith({}, 'maeve')).toBe(0);
    expect(relationshipWith({}, 'maeve')).toEqual(emptyRelationship());
  });
});

describe('what can be given at all', () => {
  it('takes produce, seed and timber', () => {
    expect(isGiftable('turnip')).toBe(true);
    expect(isGiftable('turnip-seeds')).toBe(true);
    expect(isGiftable('wood')).toBe(true);
  });

  it('refuses tools, at every tier, so the hoe cannot be given away', () => {
    expect(isGiftable('hoe')).toBe(false);
    expect(isGiftable('gold-watering-can')).toBe(false);
    expect(isGiftable('basket')).toBe(false);
  });

  it('refuses an item this build has never heard of', () => {
    expect(isGiftable('moon-rock')).toBe(false);
  });
});

describe('gift points follow the table', () => {
  it('pays what the reaction is worth, for every reaction the villager has', () => {
    // Rowan's table covers four of the five, which is enough to walk the whole
    // scale without inventing a villager for the test.
    const cases: [string, number][] = [
      ['rhubarb', REACTION_POINTS.loved],
      ['turnip', REACTION_POINTS.liked],
      ['clover', REACTION_POINTS.disliked],
      ['wood', REACTION_POINTS.hated],
      // Unlisted, so it falls to the default.
      ['tomato', REACTION_POINTS[ROWAN.defaultGiftReaction]],
    ];

    for (const [item, points] of cases) {
      const result = giveGift(emptyRelationship(), ROWAN, item, 'Summer', 1);
      expect(result.ok, `${item} was refused`).toBe(true);
      if (!result.ok) continue;
      expect(result.points, `${item} paid the wrong points`).toBe(points);
      expect(result.relationship.points).toBe(points);
      expect(result.reaction).toBe(reactionTo(ROWAN, item));
    }
  });

  it('can go backwards, and a bad gift still spends the allowance', () => {
    const result = giveGift(withPoints(200), ROWAN, 'wood', 'Summer', 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.points).toBeLessThan(0);
    expect(result.relationship.points).toBe(200 + REACTION_POINTS.hated);
    expect(result.relationship.giftsThisWeek).toBe(1);
    expect(result.relationship.giftedToday).toBe(true);
  });

  it('reports the heart it just crossed, and only on the gift that crossed it', () => {
    const crossing = giveGift(
      withPoints(POINTS_PER_HEART - REACTION_POINTS.loved),
      ROWAN,
      'rhubarb',
      'Summer',
      1,
    );
    expect(crossing.ok && crossing.heartGained).toBe(true);
    expect(crossing.ok && crossing.hearts).toBe(1);

    const short = giveGift(withPoints(10), ROWAN, 'rhubarb', 'Summer', 1);
    expect(short.ok && short.heartGained).toBe(false);
    expect(short.ok && short.hearts).toBe(0);
  });

  it('will not push past ten hearts', () => {
    const full = withPoints(POINTS_PER_HEART * MAX_HEARTS);
    const result = giveGift(full, ROWAN, 'rhubarb', 'Summer', 1);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.hearts).toBe(MAX_HEARTS);
    expect(result.relationship.points).toBe(POINTS_PER_HEART * MAX_HEARTS);
  });
});

describe('the birthday multiplier', () => {
  it('counts eight times on the day, and once on any other', () => {
    const birthday = dayIn(ROWAN.birthday.season, ROWAN.birthday.day);
    expect(isBirthday(ROWAN, ROWAN.birthday.season, birthday)).toBe(true);

    const onTheDay = giveGift(emptyRelationship(), ROWAN, 'rhubarb', ROWAN.birthday.season, birthday);
    const dayBefore = giveGift(
      emptyRelationship(),
      ROWAN,
      'rhubarb',
      ROWAN.birthday.season,
      birthday - 1,
    );

    expect(onTheDay.ok && onTheDay.birthday).toBe(true);
    expect(dayBefore.ok && dayBefore.birthday).toBe(false);
    expect(onTheDay.ok && onTheDay.points).toBe(REACTION_POINTS.loved * BIRTHDAY_MULTIPLIER);
    expect(dayBefore.ok && dayBefore.points).toBe(REACTION_POINTS.loved);
  });

  it('applies on the right day of the right season, and no other season', () => {
    const { season, day } = ROWAN.birthday;
    const wrongSeason = SEASONS.find((candidate) => candidate !== season)!;
    expect(isBirthday(ROWAN, wrongSeason, dayIn(wrongSeason, day))).toBe(false);
  });

  it('multiplies a bad gift too, which is the point of bringing the right one', () => {
    const birthday = dayIn(ROWAN.birthday.season, ROWAN.birthday.day);
    const result = giveGift(emptyRelationship(), ROWAN, 'wood', ROWAN.birthday.season, birthday);
    expect(result.ok && result.points).toBe(REACTION_POINTS.hated * BIRTHDAY_MULTIPLIER);
  });

  it('finds the birthday in any year, not only the first', () => {
    const { season, day } = ROWAN.birthday;
    const secondYear = dayIn(season, day) + SEASON_DAYS * SEASONS.length;
    expect(isBirthday(ROWAN, season, secondYear)).toBe(true);
  });
});

describe('the gift limits, which exist to stop grinding', () => {
  it('refuses the second gift in a day, and changes nothing at all', () => {
    const first = giveGift(emptyRelationship(), ROWAN, 'turnip', 'Summer', 1);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = giveGift(first.relationship, ROWAN, 'rhubarb', 'Summer', 1);
    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.reason).toContain('đã tặng');
  });

  it('refuses the third in a week, even on different days', () => {
    let relationship = emptyRelationship();
    for (let gift = 0; gift < GIFTS_PER_WEEK; gift += 1) {
      const result = giveGift(relationship, ROWAN, 'turnip', 'Summer', 1 + gift);
      expect(result.ok, `gift ${gift + 1} of the week was refused`).toBe(true);
      if (!result.ok) return;
      // A new day, so only the weekly allowance is standing in the way.
      relationship = { ...result.relationship, giftedToday: false };
    }

    const third = giveGift(relationship, ROWAN, 'turnip', 'Summer', 3);
    expect(third.ok).toBe(false);
    expect(relationship.giftsThisWeek).toBe(GIFTS_PER_WEEK);
  });

  it('refuses something that is not a gift at all', () => {
    const result = giveGift(emptyRelationship(), ROWAN, 'hoe', 'Summer', 1);
    expect(result.ok).toBe(false);
  });
});

describe('the morning reset', () => {
  it('gives back the daily gift every morning', () => {
    const before = { rowan: withPoints(100, { giftedToday: true, giftsThisWeek: 1 }) };
    const after = startRelationshipDay(before, 3);
    expect(after.rowan?.giftedToday).toBe(false);
    // Not the first day of a week, so the weekly allowance stands.
    expect(after.rowan?.giftsThisWeek).toBe(1);
    expect(after.rowan?.points).toBe(100);
  });

  it('gives back the weekly allowance on the first day of a week', () => {
    expect(isFirstDayOfWeek(1)).toBe(true);
    expect(isFirstDayOfWeek(8)).toBe(true);
    expect(isFirstDayOfWeek(5)).toBe(false);

    const before = { rowan: withPoints(100, { giftedToday: true, giftsThisWeek: 2 }) };
    const after = startRelationshipDay(before, 8);
    expect(after.rowan?.giftsThisWeek).toBe(0);
    expect(after.rowan?.giftedToday).toBe(false);
  });

  it('hands back the same object when there was nothing to reset', () => {
    // Identity matters: the store compares by it, and a fresh record every
    // dawn for a player who has met nobody is a re-render every dawn.
    const untouched = { rowan: withPoints(100) };
    expect(startRelationshipDay(untouched, 3)).toBe(untouched);
    expect(startRelationshipDay({}, 8)).toEqual({});
  });
});
