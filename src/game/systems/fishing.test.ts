import { describe, expect, it } from 'vitest';
import {
  BAIT_WAIT_SCALE,
  BITE_MS,
  availableFish,
  hookFish,
  isAvailable,
  pickFish,
  startCast,
  stepFishing,
  waitMs,
  type FishDraw,
  type FishingState,
  type FishingStep,
} from './fishing';
import { FISH_BOOK, TRASH_DEFS, barWidthOf, fishDef, isFishItem } from './items';

const TRASH_IDS = new Set(TRASH_DEFS.map((row) => row.id));

/** A summer afternoon on the river, where a good handful of species live. */
function draw(overrides: Partial<FishDraw> = {}): FishDraw {
  return {
    seed: 0x6d6f6f6e,
    totalMinutes: 14 * 60,
    area: 'village',
    tile: { x: 12, y: 9 },
    season: 'Summer',
    weather: 'Sunny',
    hour: 14,
    ...overrides,
  };
}

/** Runs a cast forward to the moment something takes it. */
function runToBite(state: FishingState): FishingState {
  let current = state;
  for (let i = 0; i < 500; i += 1) {
    const step = stepFishing(current, 50, 1, 'p1');
    if (!step.fishing) throw new Error('the cast ended before anything bit');
    current = step.fishing;
    if (step.outcome === 'bite') return current;
  }
  throw new Error('nothing bit within ten seconds');
}

describe('which fish is on the line', () => {
  it('is the same fish for the same seed, minute and tile', () => {
    const once = pickFish(draw());
    const again = pickFish(draw());
    expect(again).toEqual(once);
  });

  it('is a different draw a minute later, and in the next pond along', () => {
    const here = pickFish(draw());
    const later = pickFish(draw({ totalMinutes: 14 * 60 + 1 }));
    const elsewhere = pickFish(draw({ tile: { x: 13, y: 9 } }));
    // Not a guarantee about any one pair — two draws may legitimately land on
    // the same species — but all three being identical would mean the tuple is
    // not reaching the hash at all.
    expect([later.fish, elsewhere.fish, later.size, elsewhere.size]).not.toEqual([
      here.fish,
      here.fish,
      here.size,
      here.size,
    ]);
  });

  it('never picks a fish that is out of season', () => {
    const salmon = FISH_BOOK.salmon;
    expect(isAvailable(salmon, { area: 'village', season: 'Autumn', weather: 'Sunny', hour: 10 })).toBe(true);
    expect(isAvailable(salmon, { area: 'village', season: 'Spring', weather: 'Sunny', hour: 10 })).toBe(false);
  });

  it('never picks a fish that wants weather this sky is not', () => {
    const catfish = FISH_BOOK.catfish;
    expect(isAvailable(catfish, { area: 'village', season: 'Spring', weather: 'Drizzle', hour: 10 })).toBe(true);
    expect(isAvailable(catfish, { area: 'village', season: 'Spring', weather: 'Sunny', hour: 10 })).toBe(false);
  });

  it('never picks a fish outside its hours, with the end of the window exclusive', () => {
    const sunfish = FISH_BOOK.sunfish;
    expect(isAvailable(sunfish, { area: 'village', season: 'Summer', weather: 'Sunny', hour: 6 })).toBe(true);
    expect(isAvailable(sunfish, { area: 'village', season: 'Summer', weather: 'Sunny', hour: 18 })).toBe(true);
    expect(isAvailable(sunfish, { area: 'village', season: 'Summer', weather: 'Sunny', hour: 19 })).toBe(false);
  });

  it('counts the small hours as late rather than early', () => {
    // 25 is one in the morning of the day that began at six. A wrapping clock
    // would call it hour 1 and put it before every daytime window.
    const midnightCarp = FISH_BOOK['midnight-carp'];
    expect(isAvailable(midnightCarp, { area: 'forest', season: 'Winter', weather: 'Sunny', hour: 25 })).toBe(true);
    expect(isAvailable(midnightCarp, { area: 'forest', season: 'Winter', weather: 'Sunny', hour: 12 })).toBe(false);
  });

  it('never picks a fish that does not live in this water', () => {
    const forest = availableFish({ area: 'forest', season: 'Winter', weather: 'Sunny', hour: 10 });
    expect(forest.length).toBeGreaterThan(0);
    for (const fish of forest) expect(fish.areas).toContain('forest');
  });

  it('gives up rubbish rather than nothing when the water is out of season', () => {
    // A farm pond in a dry spring: the bass wants rain and nothing else is
    // stocked there, so there is genuinely nothing to catch.
    const empty = availableFish({ area: 'farm', season: 'Spring', weather: 'Sunny', hour: 8 });
    const stocked = empty.filter((fish) => fish.areas.includes('farm'));
    if (stocked.length === 0) {
      const picked = pickFish(draw({ area: 'farm', season: 'Spring', weather: 'Sunny', hour: 8 }));
      expect(TRASH_IDS.has(picked.fish)).toBe(true);
    }
  });

  it('draws a size inside the species own range', () => {
    for (let minute = 0; minute < 200; minute += 1) {
      const picked = pickFish(draw({ totalMinutes: 6 * 60 + minute }));
      const def = fishDef(picked.fish);
      expect(def).not.toBeNull();
      expect(picked.size).toBeGreaterThanOrEqual(def!.minSize);
      expect(picked.size).toBeLessThanOrEqual(def!.maxSize);
    }
  });

  it('only ever names things the item table knows about', () => {
    for (let minute = 0; minute < 120; minute += 1) {
      expect(isFishItem(pickFish(draw({ totalMinutes: 6 * 60 + minute })).fish)).toBe(true);
    }
  });
});

describe('bait', () => {
  it('halves the wait and changes nothing else', () => {
    const plain = waitMs(draw(), false);
    const baited = waitMs(draw(), true);
    expect(baited).toBe(Math.round(plain * BAIT_WAIT_SCALE));
  });

  it('does not change which fish is on the line', () => {
    const plain = startCast(draw(), 0.2, false);
    const baited = startCast(draw(), 0.2, true);
    expect(baited.fish).toBe(plain.fish);
    expect(baited.size).toBe(plain.size);
  });
});

describe('the phases of a cast', () => {
  it('goes casting, waiting, biting, and says so exactly once', () => {
    const cast = startCast(draw(), 0.2, true);
    expect(cast.phase).toBe('casting');

    let current = cast;
    const outcomes: string[] = [];
    for (let i = 0; i < 400; i += 1) {
      const step = stepFishing(current, 50, 1, 'p1');
      outcomes.push(step.outcome);
      if (!step.fishing) break;
      current = step.fishing;
    }
    expect(outcomes.filter((outcome) => outcome === 'bite')).toHaveLength(1);
  });

  it('loses the fish when nobody strikes inside the bite window', () => {
    // Stepped rather than skipped: one huge delta is clamped on purpose, so
    // the window has to be run out a frame at a time the way it really is.
    let current: FishingState | null = runToBite(startCast(draw(), 0.2, true));
    let outcome = 'none';
    for (let elapsed = 0; elapsed <= BITE_MS + 100 && current; elapsed += 50) {
      const step: FishingStep = stepFishing(current, 50, 1, 'p1');
      outcome = step.outcome;
      current = step.fishing;
    }
    expect(outcome).toBe('missed');
    expect(current).toBeNull();

    // And a strike inside the window hooks instead.
    expect(hookFish(runToBite(startCast(draw(), 0.2, true)))?.phase).toBe('reeling');
  });

  /**
   * The guard that stops a browser costing somebody a fish.
   *
   * A backgrounded tab comes back with one enormous delta. Clamped, it is a
   * slow frame; unclamped it would run the whole bite window out and drain the
   * bar from end to end before the player's screen had even repainted.
   */
  it('advances a cast by no more than a slow frame, however long the stall', () => {
    const biting = runToBite(startCast(draw(), 0.2, true));
    const stalled = stepFishing(biting, 5000, 1, 'p1');
    expect(stalled.outcome).toBe('none');
    expect(stalled.fishing?.phase).toBe('biting');
  });

  it('refuses a strike at anything but a bite', () => {
    const cast = startCast(draw(), 0.2, false);
    expect(hookFish(cast)).toBeNull();
    let waiting = cast;
    // The throw is 700ms and a step is capped at 120, so this is seven frames
    // rather than one skip forward.
    while (waiting.phase === 'casting') waiting = stepFishing(waiting, 100, 1, 'p1').fishing!;
    expect(waiting.phase).toBe('waiting');
    expect(hookFish(waiting)).toBeNull();
  });
});

/** A hooked fish, ready for the bar, with the rod's square frozen in. */
function hooked(barWidth: number, fish = 'carp'): FishingState {
  const cast = startCast(draw(), barWidth, false);
  const biting = runToBite(cast);
  return { ...hookFish(biting)!, fish, fishAt: 0.5, barAt: 0.5 - barWidth / 2 };
}

describe('the bar', () => {
  it('fills while the square covers the fish and drains while it does not', () => {
    const covering = hooked(0.4);
    const gained = stepFishing(covering, 100, 1, 'p1').fishing!;
    expect(gained.progress).toBeGreaterThan(covering.progress);

    // The same fish, with the square parked at the far end of the bar.
    const missing: FishingState = { ...covering, barAt: 0, fishAt: 0.95 };
    const lost = stepFishing(missing, 100, 1, 'p1').fishing!;
    expect(lost.progress).toBeLessThan(missing.progress);
  });

  it('lands the fish at full and loses it at empty', () => {
    const nearlyThere: FishingState = { ...hooked(0.4), progress: 0.99 };
    const landed = stepFishing(nearlyThere, 200, 1, 'p1');
    expect(landed.outcome).toBe('caught');
    expect(landed.fishing?.landed).toBe(true);

    const nearlyGone: FishingState = { ...hooked(0.4), progress: 0.01, barAt: 0, fishAt: 0.95 };
    const gone = stepFishing(nearlyGone, 400, 1, 'p1');
    expect(gone.outcome).toBe('escaped');
    expect(gone.fishing).toBeNull();
  });

  it('holds a landed fish still, so a full satchel cannot lose it', () => {
    const waiting: FishingState = { ...hooked(0.4), landed: true, progress: 1 };
    const step = stepFishing(waiting, 5000, 1, 'p1');
    expect(step.outcome).toBe('none');
    expect(step.fishing).toBe(waiting);
  });

  it('lifts the square while the reel is held and drops it when it is not', () => {
    const held: FishingState = { ...hooked(0.3), reeling: true, barAt: 0.3 };
    expect(stepFishing(held, 200, 1, 'p1').fishing!.barAt).toBeGreaterThan(0.3);

    const released: FishingState = { ...held, reeling: false, barVelocity: 0 };
    expect(stepFishing(released, 200, 1, 'p1').fishing!.barAt).toBeLessThan(0.3);
  });

  it('keeps the square inside the bar at both ends', () => {
    const width = 0.3;
    let rising: FishingState = { ...hooked(width), reeling: true, barAt: 0.9 };
    for (let i = 0; i < 40; i += 1) rising = stepFishing(rising, 50, 1, 'p1').fishing ?? rising;
    expect(rising.barAt).toBeLessThanOrEqual(1 - width + 1e-9);

    let falling: FishingState = { ...hooked(width), reeling: false, barAt: 0.05 };
    for (let i = 0; i < 40; i += 1) falling = stepFishing(falling, 50, 1, 'p1').fishing ?? falling;
    expect(falling.barAt).toBeGreaterThanOrEqual(0);
  });

  it('drains faster for a harder fish, which is what difficulty means', () => {
    const easy: FishingState = { ...hooked(0.2, 'carp'), barAt: 0, fishAt: 0.95 };
    const hard: FishingState = { ...hooked(0.2, 'moonfish'), barAt: 0, fishAt: 0.95 };
    const easyLeft = stepFishing(easy, 200, 1, 'p1').fishing!.progress;
    const hardLeft = stepFishing(hard, 200, 1, 'p1').fishing!.progress;
    expect(hardLeft).toBeLessThan(easyLeft);
  });
});

describe('what a better rod buys', () => {
  it('is a wider square, and nothing else', () => {
    expect(barWidthOf('gold-fishing-rod')).toBeGreaterThan(barWidthOf('fishing-rod'));
    expect(barWidthOf('steel-fishing-rod')).toBeGreaterThan(barWidthOf('copper-fishing-rod'));
  });

  /**
   * The claim the whole tier ladder rests on, checked rather than asserted.
   *
   * Both rods fight the same fish from the same seed with the same input — the
   * reel held whenever the fish is above the middle of the square, which is a
   * crude but consistent player — and the wider square must win more often.
   */
  it('lands the same fish sooner than the first rung does', () => {
    /**
     * How many frames it takes to land one fish, or Infinity for one lost.
     *
     * The player here is deliberately imperfect: they only look at the bar
     * every 150ms, which is roughly a human reaction and is also the latency
     * spec 12 warns about. A perfect player holds everything with the narrow
     * square too, and a test that cannot tell the rods apart is a test that
     * has not measured the thing the tier ladder sells.
     */
    const frames = (barWidth: number, fish: string): number => {
      let state: FishingState = { ...hooked(barWidth, fish) };
      let hold = false;
      let sinceLook = 0;
      for (let i = 0; i < 1200; i += 1) {
        sinceLook += 32;
        if (sinceLook >= 150) {
          sinceLook = 0;
          hold = state.fishAt > state.barAt + state.barWidth / 2;
        }
        state = { ...state, reeling: hold };
        const step = stepFishing(state, 32, 7, 'p1');
        if (step.outcome === 'caught') return i;
        if (!step.fishing) return Number.POSITIVE_INFINITY;
        state = step.fishing;
      }
      return Number.POSITIVE_INFINITY;
    };

    const hardFish = ['pike', 'sturgeon', 'eel', 'lingcod', 'moonfish', 'catfish', 'walleye'];
    let better = 0;
    let worse = 0;
    for (const fish of hardFish) {
      const basic = frames(barWidthOf('fishing-rod'), fish);
      const gold = frames(barWidthOf('gold-fishing-rod'), fish);
      if (gold < basic) better += 1;
      if (gold > basic) worse += 1;
    }
    expect(better).toBeGreaterThan(worse);
  });
});

describe('two people fishing at once', () => {
  it('fight independent fish, because the course is drawn per player', () => {
    // Run a few frames each rather than one long step: a single huge delta
    // saturates both fish against the per-frame speed cap, which would make
    // two different courses land on the same place and prove nothing.
    const run = (playerId: string): number => {
      let state = hooked(0.3, 'pike');
      for (let i = 0; i < 24; i += 1) state = stepFishing(state, 50, 1, playerId).fishing!;
      return state.fishAt;
    };
    expect(run('ana')).not.toBe(run('bo'));
  });

  it('draw different fish from different ponds in the same minute', () => {
    const farm = pickFish(draw({ area: 'farm', tile: { x: 4, y: 4 } }));
    const forest = pickFish(draw({ area: 'forest', tile: { x: 4, y: 4 } }));
    // Nothing in the table lives in both of those waters in summer sunshine,
    // so this is a statement about the table as much as about the draw.
    expect(farm.fish === forest.fish && farm.size === forest.size).toBe(false);
  });
});
