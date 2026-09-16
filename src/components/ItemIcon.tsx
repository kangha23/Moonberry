import { ICON_SIZE, iconFor } from '../game/assets/itemIcons';
import { LPC_URL_BY_KEY } from '../game/assets/lpc.generated';
import { ITEMS, type ItemId } from '../game/systems/items';

/**
 * One item's art: the drawing if there is one, the rectangles if there is not.
 *
 * The rectangles are the same ones the Phaser hotbar fills onto a canvas, so a
 * turnip in the grid is the turnip in the hotbar. When real art arrives for an
 * item, both sides switch together — Phaser because `withTexture` yields to a
 * loaded image, and this because the key is in the manifest — which is what
 * closes the old gap where a field sprite and a satchel icon agreed on colour
 * but not on shape.
 */
export default function ItemIcon({ item, size = 32 }: { item: ItemId; size?: number }) {
  const url = LPC_URL_BY_KEY[ITEMS[item].texture];
  if (url) {
    return <img className="item-icon" src={url} width={size} height={size} alt="" aria-hidden="true" />;
  }

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
