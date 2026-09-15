/**
 * Drawing something the reducer only moves once a clock step.
 *
 * The animals and the villagers are walked by `advanceClock`, which runs every
 * 1200 real milliseconds and moves each of them a whole step at once — sixty
 * world pixels for an animal, a hundred and twenty for a villager. Between
 * those moments the state says nothing at all, so the renderer has to invent
 * the seventy frames in the middle. This is that invention.
 *
 * It used to be an exponential ease: `position += (target - position) * delta /
 * 260`. Which is the right shape for a camera and the wrong one for feet. The
 * numbers say why — a sixty-pixel step eased with a 260ms time constant leaves
 * at 231 px/s and arrives at 2 px/s, against a true walking pace of 50 px/s:
 *
 *     0ms   100ms  300ms  600ms  900ms  1190ms
 *     231    157     73     23      7      2      px/s
 *
 * So every animal on the farm lunged four and a half times its own speed,
 * coasted to a near stop, and then lunged again 1.2 seconds later — while its
 * legs cycled at a constant eight frames a second throughout. That reads as
 * hopping, and no amount of better art fixes it, because it is not the art.
 *
 * What is drawn instead is a straight line at constant speed: start where the
 * last step left off, finish where the state says, and take exactly one step's
 * worth of time doing it. The sprite is up to one step behind the simulation,
 * which is the price and is not visible — nobody can see that a cow is 60px
 * behind where the model thinks it is, and everybody can see it hop.
 */

export { CLOCK_STEP_MS } from '../state/reducer';
import { CLOCK_STEP_MS } from '../state/reducer';

/**
 * Anything far enough away to be a teleport rather than a walk.
 *
 * Six tiles. A step is never more than two, so the only things that cross this
 * are a stall long enough to bank several steps at once and a sprite reused
 * for something that moved somewhere else entirely. Sliding smoothly across
 * six tiles of farm is a worse lie than admitting the jump.
 */
const SNAP_BEYOND = 192;

/**
 * How far past a step's end the legs keep going before they stop.
 *
 * The chase counts its own milliseconds and the reducer counts its own, so the
 * frame on which a line finishes and the frame on which the next one arrives
 * are near neighbours rather than the same frame. Without a little slack the
 * walk cycle would be stopped and restarted from its first frame in that gap,
 * every step, for ever — which is a hitch in the legs of an animal that never
 * stopped walking. A quarter of a step is far more than the gap is ever worth
 * and far less than the 1.2 seconds a genuinely standing animal waits.
 */
const WALK_GRACE = 1.25;

export interface TickChase {
  /** Where to draw it: the answer this whole file exists to produce. */
  x: number;
  y: number;
  /** The two ends of the line currently being walked. */
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  /** Real milliseconds since this line began. */
  elapsed: number;
}

export function createChase(x: number, y: number): TickChase {
  return { x, y, fromX: x, fromY: y, toX: x, toY: y, elapsed: CLOCK_STEP_MS };
}

/**
 * Moves the chase on by one frame and returns whether it is walking.
 *
 * A new target starts a new line **from wherever the sprite actually is**,
 * not from where the last line was supposed to end. Those are the same point
 * whenever the previous step completed, and when it did not — a step arriving
 * early, a frame lost — starting from the truth is what keeps the correction
 * smooth instead of snapping.
 *
 * `moving` is the length of the line rather than the distance covered this
 * frame. An animal standing still between two wander targets has a line of
 * zero and should stand; one walking has a line of sixty and should keep its
 * legs going for the whole step, including the frames where rounding puts it
 * in the same pixel as the last one.
 */
export function advanceChase(
  chase: TickChase,
  targetX: number,
  targetY: number,
  deltaMs: number,
  stepMs: number = CLOCK_STEP_MS,
): boolean {
  if (targetX !== chase.toX || targetY !== chase.toY) {
    chase.fromX = chase.x;
    chase.fromY = chase.y;
    chase.toX = targetX;
    chase.toY = targetY;
    chase.elapsed = 0;
  }

  const spanX = chase.toX - chase.fromX;
  const spanY = chase.toY - chase.fromY;
  const span = Math.hypot(spanX, spanY);

  if (span > SNAP_BEYOND) {
    chase.x = chase.fromX = targetX;
    chase.y = chase.fromY = targetY;
    chase.elapsed = stepMs;
    return false;
  }

  // Counted past the end rather than clamped at it, because how long ago a
  // line finished is the difference between a pause between steps and an
  // animal that has arrived where it was going.
  chase.elapsed += Math.max(0, deltaMs);
  const t = stepMs > 0 ? Math.min(chase.elapsed / stepMs, 1) : 1;
  chase.x = chase.fromX + spanX * t;
  chase.y = chase.fromY + spanY * t;

  return span > 0.5 && chase.elapsed < stepMs * WALK_GRACE;
}

/**
 * Which way something walking this line is facing.
 *
 * Read off the line rather than off the last frame's movement, which is the
 * same answer without the noise: a frame in which rounding happened to move
 * the sprite half a pixel sideways is not the cow turning round.
 *
 * Vertical only when it clearly outweighs the horizontal, because a cow
 * ambling east down a slightly sloping line is walking east.
 */
export function chaseFacing(chase: TickChase): 'up' | 'down' | 'left' | 'right' {
  const dx = chase.toX - chase.fromX;
  const dy = chase.toY - chase.fromY;
  if (Math.abs(dy) > Math.abs(dx)) return dy > 0 ? 'down' : 'up';
  return dx > 0 ? 'right' : 'left';
}
