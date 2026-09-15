import { ICON_SIZE, iconFor } from '../game/assets/itemIcons';
import type { ItemId } from '../game/systems/items';

/**
 * One item's art, as SVG.
 *
 * The same rectangles the Phaser hotbar fills onto a canvas, so a turnip in the
 * grid is the turnip in the hotbar. `shapeRendering` keeps the pixels square at
 * any size instead of letting the browser smooth them into mush.
 */
export default function ItemIcon({ item, size = 32 }: { item: ItemId; size?: number }) {
  const shapes = iconFor(item);
  return (
    <svg
      className="item-icon"
      width={size}
      height={size}
      viewBox={`0 0 ${ICON_SIZE} ${ICON_SIZE}`}
      shapeRendering="crispEdges"
      aria-hidden="true"
      focusable="false"
    >
      {shapes.map(([color, x, y, w, h], index) => (
        <rect key={index} fill={color} x={x} y={y} width={w} height={h} />
      ))}
    </svg>
  );
}
