import { describe, expect, it } from 'vitest';
import { CLOCK_STEP_MS, advanceChase, chaseFacing, createChase } from './tickChase';

/** One step of an animal: sixty world pixels east, per the reducer's pace. */
const STEP = 60;

/** Runs `frames` frames of `delta` ms each, holding one target. */
function run(chase: ReturnType<typeof createChase>, x: number, y: number, frames: number, delta = 16) {
  const speeds: number[] = [];
  for (let i = 0; i < frames; i += 1) {
    const before = { x: chase.x, y: chase.y };
    advanceChase(chase, x, y, delta);
    speeds.push(Math.hypot(chase.x - before.x, chase.y - before.y) / (delta / 1000));
  }
  return speeds;
}

describe('advanceChase', () => {
  it('walks a step at one steady speed instead of lunging', () => {
    // The bug this replaces, stated as a number. The old exponential ease left
    // at 231 px/s and arrived at 2 px/s for a step whose true pace is 50 —
    // 115 times faster at the start than at the end, every 1.2 seconds. What
    // a walk needs is one speed.
    const chase = createChase(0, 0);
    const speeds = run(chase, STEP, 0, 75).filter((speed) => speed > 0);
    const fastest = Math.max(...speeds);
    const slowest = Math.min(...speeds);
    expect(fastest / slowest).toBeLessThan(1.05);
    expect(fastest).toBeCloseTo((STEP / CLOCK_STEP_MS) * 1000, 0);
  });

  it('arrives exactly where the state said, exactly one step later', () => {
    const chase = createChase(0, 0);
    run(chase, STEP, 0, Math.ceil(CLOCK_STEP_MS / 16));
    expect(chase.x).toBeCloseTo(STEP, 6);
    expect(chase.y).toBeCloseTo(0, 6);
  });

  it('never overshoots, however long the frame', () => {
    // A frame ten times longer than a step must land on the target, not past
    // it: a dropped frame is a stutter, and an overshoot is a cow in a pond.
    const chase = createChase(0, 0);
    advanceChase(chase, STEP, 0, CLOCK_STEP_MS * 10);
    expect(chase.x).toBe(STEP);
  });

  it('starts the next step from where the sprite actually is', () => {
    // Half a step in, the state moves again. The new line has to begin at the
    // sprite rather than at the target it never reached, or it jumps.
    const chase = createChase(0, 0);
    run(chase, STEP, 0, Math.round(CLOCK_STEP_MS / 2 / 16));
    const midway = chase.x;
    expect(midway).toBeGreaterThan(20);
    expect(midway).toBeLessThan(40);

    advanceChase(chase, STEP * 2, 0, 16);
    expect(chase.fromX).toBeCloseTo(midway, 6);
    // One frame's worth past it, and no more.
    expect(chase.x - midway).toBeLessThan(3);
  });

  it('stands still when the state says it has arrived', () => {
    const chase = createChase(0, 0);
    run(chase, STEP, 0, 100);
    // The target has not changed for a whole further step: it is grazing, and
    // the legs stop once the grace after the step has run out.
    expect(run(chase, STEP, 0, 20).every((speed) => speed === 0)).toBe(true);
    expect(advanceChase(chase, STEP, 0, 16)).toBe(false);
  });

  it('reports walking for every frame of a step, not just the ones that moved a pixel', () => {
    // `moving` drives the walk cycle. Reading it off "did the sprite move
    // since last frame" made the legs stutter at low frame rates and near the
    // end of a step; it is a property of the line, not of the frame.
    const chase = createChase(0, 0);
    const walking: boolean[] = [];
    for (let i = 0; i < 75; i += 1) walking.push(advanceChase(chase, STEP, 0, 16));
    expect(walking.every(Boolean)).toBe(true);
  });

  it('keeps the legs going across the seam between two steps', () => {
    // The chase and the reducer count their own milliseconds, so a step can
    // finish a frame or two before the next one lands. Stopping the walk
    // cycle in that gap restarts it from frame one every 1.2 seconds.
    const chase = createChase(0, 0);
    for (let i = 0; i < 76; i += 1) advanceChase(chase, STEP, 0, 16);
    expect(advanceChase(chase, STEP, 0, 16)).toBe(true);
  });

  it('snaps rather than sliding across the farm', () => {
    const chase = createChase(0, 0);
    expect(advanceChase(chase, 400, 0, 16)).toBe(false);
    expect([chase.x, chase.y]).toEqual([400, 0]);
  });

  it('survives a zero-length step without dividing by it', () => {
    const chase = createChase(0, 0);
    advanceChase(chase, STEP, 0, 16, 0);
    expect(chase.x).toBe(STEP);
  });
});

describe('chaseFacing', () => {
  it('reads the direction off the whole step', () => {
    const chase = createChase(0, 0);
    advanceChase(chase, 60, 0, 16);
    expect(chaseFacing(chase)).toBe('right');
    advanceChase(chase, 60, 60, 16);
    expect(chaseFacing(chase)).toBe('down');
  });

  it('calls a mostly-sideways amble sideways', () => {
    const chase = createChase(0, 0);
    advanceChase(chase, 40, -12, 16);
    expect(chaseFacing(chase)).toBe('right');
  });
});
