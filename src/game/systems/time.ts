export type Season = 'Spring' | 'Summer' | 'Autumn' | 'Winter';
export type Weather = 'Sunny' | 'Drizzle' | 'Breezy' | 'Firefly Shower';

export interface TimeState {
  day: number;
  hour: number;
  minute: number;
  totalMinutes: number;
}

/** 6am, when everyone wakes up. */
export const DAY_START = 6 * 60;

/**
 * 02:00 the next morning, as minutes past midnight of the day that began.
 * The clock is a running total rather than a wall clock, so a day that wrapped
 * back to 0 would make the comparison in `advanceTime` go backwards; 26:00
 * keeps it monotonic, and the clock formatter turns it back into "2:10 AM".
 */
export const DAY_END = 26 * 60;

export function createTimeState(day = 1, totalMinutes = DAY_START): TimeState {
  return {
    day,
    totalMinutes,
    hour: Math.floor(totalMinutes / 60) % 24,
    minute: totalMinutes % 60,
  };
}

export function advanceTime(time: TimeState, minutes: number): { time: TimeState; newDay: boolean } {
  const nextTotal = time.totalMinutes + minutes;
  if (nextTotal >= DAY_END) {
    return { time: createTimeState(time.day + 1, DAY_START), newDay: true };
  }
  return { time: createTimeState(time.day, nextTotal), newDay: false };
}

/** The year, in order. Also what `seasonForDay` indexes into. */
export const SEASONS: readonly Season[] = ['Spring', 'Summer', 'Autumn', 'Winter'];

/** Every sky the farm can wake up to, which is what `weatherForDay` draws from. */
export const WEATHERS: readonly Weather[] = ['Sunny', 'Drizzle', 'Breezy', 'Firefly Shower'];

/**
 * Vietnamese display names for the seasons.
 *
 * The union members stay English because they are identifiers: they are keyed
 * on in schedules, written into saves and sent over the wire. Only what the
 * player reads is translated, and it is translated in exactly one place.
 */
export const SEASON_LABELS: Record<Season, string> = {
  Spring: 'Xuân',
  Summer: 'Hạ',
  Autumn: 'Thu',
  Winter: 'Đông',
};

/** Vietnamese display names for the sky, for the same reason as the seasons. */
export const WEATHER_LABELS: Record<Weather, string> = {
  Sunny: 'Nắng',
  Drizzle: 'Mưa phùn',
  Breezy: 'Gió nhẹ',
  'Firefly Shower': 'Mưa đom đóm',
};

export function seasonLabel(season: Season): string {
  return SEASON_LABELS[season];
}

export function weatherLabel(weather: Weather): string {
  return WEATHER_LABELS[weather];
}

/** How many days a season lasts. Stardew's 28, and a month reads as a month. */
export const SEASON_DAYS = 28;

export function seasonForDay(day: number): Season {
  const year = SEASON_DAYS * SEASONS.length;
  return SEASONS[Math.floor(((day - 1) % year) / SEASON_DAYS)];
}

/** Which day of its own season a day is, from 1 to `SEASON_DAYS`. */
export function dayOfSeason(day: number): number {
  return ((day - 1) % SEASON_DAYS) + 1;
}

/**
 * How many days are left in this season, counting today.
 *
 * 1 on the last day, which is the day a crop that cannot survive the turn has
 * its final night. What the number is *for* is the warning: spec 04 wilts a
 * doomed crop once this drops to three or fewer.
 */
export function daysLeftInSeason(day: number): number {
  return SEASON_DAYS - dayOfSeason(day) + 1;
}

/** What follows this season, wrapping Winter back round to Spring. */
export function nextSeason(season: Season): Season {
  return SEASONS[(SEASONS.indexOf(season) + 1) % SEASONS.length];
}

export function weatherForDay(day: number): Weather {
  const roll = (day * 9301 + 49297) % 233280;
  const normalized = roll / 233280;
  if (day % 13 === 0) return 'Firefly Shower';
  if (normalized < 0.24) return 'Drizzle';
  if (normalized < 0.48) return 'Breezy';
  return 'Sunny';
}

export function isRainy(weather: Weather): boolean {
  return weather === 'Drizzle' || weather === 'Firefly Shower';
}
