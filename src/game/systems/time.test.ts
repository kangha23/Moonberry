import { describe, expect, it } from 'vitest';
import {
  DAY_END,
  SEASON_DAYS,
  advanceTime,
  createTimeState,
  dayOfSeason,
  daysLeftInSeason,
  isRainy,
  nextSeason,
  seasonForDay,
  weatherForDay,
} from './time';

describe('time and weather systems', () => {
  it('runs past midnight to 02:00 before the day turns over', () => {
    const start = createTimeState(4, DAY_END - 10);
    const result = advanceTime(start, 20);

    expect(result.newDay).toBe(true);
    expect(result.time.day).toBe(5);
    expect(result.time.hour).toBe(6);
    expect(result.time.minute).toBe(0);
  });

  it('keeps counting up past midnight rather than wrapping to zero', () => {
    // The clock is a running total, so the small hours read as 24:00 and up;
    // only the hour it reports wraps, which is what the formatter shows.
    const result = advanceTime(createTimeState(4, 23 * 60 + 50), 20);

    expect(result.newDay).toBe(false);
    expect(result.time.totalMinutes).toBe(24 * 60 + 10);
    expect(result.time.hour).toBe(0);
    expect(result.time.minute).toBe(10);
  });

  it('maps days to seasons in 28-day arcs', () => {
    expect(seasonForDay(1)).toBe('Spring');
    expect(seasonForDay(29)).toBe('Summer');
    expect(seasonForDay(57)).toBe('Autumn');
    expect(seasonForDay(85)).toBe('Winter');
  });

  it('uses deterministic weather with special firefly showers', () => {
    expect(weatherForDay(13)).toBe('Firefly Shower');
    expect(weatherForDay(13)).toBe(weatherForDay(13));
    expect(isRainy('Drizzle')).toBe(true);
    expect(isRainy('Breezy')).toBe(false);
  });
});

describe('the calendar', () => {
  it('runs four seasons of 28 days and comes back round', () => {
    expect(seasonForDay(1)).toBe('Spring');
    expect(seasonForDay(SEASON_DAYS)).toBe('Spring');
    expect(seasonForDay(SEASON_DAYS + 1)).toBe('Summer');
    expect(seasonForDay(SEASON_DAYS * 3)).toBe('Autumn');
    expect(seasonForDay(SEASON_DAYS * 4)).toBe('Winter');
    // The second year is the first one again.
    expect(seasonForDay(SEASON_DAYS * 4 + 1)).toBe('Spring');
  });

  it('numbers the days inside a season from one', () => {
    expect(dayOfSeason(1)).toBe(1);
    expect(dayOfSeason(SEASON_DAYS)).toBe(SEASON_DAYS);
    expect(dayOfSeason(SEASON_DAYS + 1)).toBe(1);
  });

  it('counts the days left inclusive of today, ending at one', () => {
    expect(daysLeftInSeason(1)).toBe(SEASON_DAYS);
    // The last three days, which is exactly the window a doomed crop wilts in.
    expect(daysLeftInSeason(SEASON_DAYS - 2)).toBe(3);
    expect(daysLeftInSeason(SEASON_DAYS)).toBe(1);
    expect(daysLeftInSeason(SEASON_DAYS + 1)).toBe(SEASON_DAYS);
  });

  it('knows what season is coming, including the turn of the year', () => {
    expect(nextSeason('Spring')).toBe('Summer');
    expect(nextSeason('Autumn')).toBe('Winter');
    expect(nextSeason('Winter')).toBe('Spring');
  });

  it('agrees with itself: the day after the last is the next season', () => {
    for (let day = 1; day <= SEASON_DAYS * 4; day += 1) {
      if (daysLeftInSeason(day) !== 1) continue;
      expect(seasonForDay(day + 1)).toBe(nextSeason(seasonForDay(day)));
    }
  });
});
