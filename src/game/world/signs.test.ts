import { describe, expect, it } from 'vitest';
import { AREAS, TILE_SIZE, isWalkable, portalAt, tileAt, type AreaProp, type StaticAreaId as AreaId } from './areas';
import { SIGN_KINDS, signKindOf, signLines } from './tiled';

/**
 * The road signs and the cột mốc on the shipped maps.
 *
 * The parser already refuses a sign that is malformed. What only the maps can
 * be asked is whether a sign is somewhere sensible: standing on ground, clear
 * of every other prop, and — for a road sign — pointing at a door that is
 * actually that way.
 */
const AREA_LIST = Object.keys(AREAS) as AreaId[];

function boards(area: AreaId, kind: 'signpost' | 'milestone'): AreaProp[] {
  return AREAS[area].props.filter((prop) => signKindOf(prop.texture) === kind);
}

function overlaps(a: AreaProp, b: AreaProp): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

describe('road signs on the maps', () => {
  it('stand at every way into and out of the phố, and at the farm’s door to the village', () => {
    const count = (area: AreaId) => boards(area, 'signpost').length;
    expect(count('plaza')).toBe(2);
    expect(count('farm')).toBeGreaterThanOrEqual(2);
    expect(count('village')).toBeGreaterThanOrEqual(2);
  });

  it('stand on open ground, over no other prop and in no doorway', () => {
    for (const area of AREA_LIST) {
      const map = AREAS[area];
      for (const sign of map.props.filter((prop) => signKindOf(prop.texture) === 'signpost' || signKindOf(prop.texture) === 'milestone')) {
        const label = `${area} ${sign.name}`;
        for (const other of map.props) {
          if (other !== sign) expect(overlaps(sign, other), `${label} stands on ${other.name}`).toBe(false);
        }
        for (let x = sign.x; x < sign.x + sign.width; x += TILE_SIZE) {
          const tile = tileAt(area, x / TILE_SIZE, sign.y / TILE_SIZE);
          expect(tile && !tile.solid && tile.kind !== 'water', `${label} stands in water or a wall`).toBe(true);
          expect(portalAt(area, { x: x + 16, y: sign.y + 16 }), `${label} stands in a doorway`).toBeNull();
        }
      }
    }
  });

  it('point at a door that is really that way', () => {
    for (const area of AREA_LIST) {
      const map = AREAS[area];
      for (const sign of boards(area, 'signpost')) {
        const cx = sign.x + sign.width / 2;
        const cy = sign.y + sign.height / 2;
        // The nearest door is the one a sign is about, and it has to be on the
        // side the arrow says.
        const nearest = [...map.portals].sort(
          (a, b) =>
            Math.hypot(a.x + a.width / 2 - cx, a.y + a.height / 2 - cy) -
            Math.hypot(b.x + b.width / 2 - cx, b.y + b.height / 2 - cy),
        )[0];
        const dx = nearest ? nearest.x + nearest.width / 2 - cx : 0;
        const dy = nearest ? nearest.y + nearest.height / 2 - cy : 0;
        const ahead =
          (sign.arrow === 'left' && dx < 0) ||
          (sign.arrow === 'right' && dx > 0) ||
          (sign.arrow === 'up' && dy < 0) ||
          (sign.arrow === 'down' && dy > 0);
        expect(ahead, `${area} ${sign.name} points ${sign.arrow}, away from its nearest door`).toBe(true);
      }
    }
  });

  it('leave the lane beside them walkable', () => {
    // Not solid, so a sign on a lane's verge never pinches the lane.
    for (const area of AREA_LIST) {
      for (const sign of boards(area, 'signpost')) {
        expect(sign.solid).toBe(false);
        expect(isWalkable(area, sign.x + sign.width / 2, sign.y + sign.height / 2)).toBe(true);
      }
    }
  });

  it('fit their lines on their board', () => {
    for (const area of AREA_LIST) {
      for (const prop of AREAS[area].props) {
        const kind = signKindOf(prop.texture);
        if (!kind || !prop.sign) continue;
        expect(signLines(prop.sign).length).toBeLessThanOrEqual(SIGN_KINDS[kind].maxLines);
      }
    }
  });
});
