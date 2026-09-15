import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import ItemIcon from './ItemIcon';
import { inventorySlots, localPlayer, openChest } from '../game/state/selectors';
import { farmStore, sendAction } from '../game/state/store';
import { INVENTORY_SIZE, type ItemStack } from '../game/systems/inventory';
import { ITEMS } from '../game/systems/items';

type Side = 'player' | 'chest';
interface Ref {
  side: Side;
  slot: number;
}

/**
 * A chest, open.
 *
 * Two grids side by side and one drag that crosses between them. The crossing
 * is the whole panel: the satchel on the left is the same array the satchel
 * screen draws, the chest on the right is an ordinary `Inventory` that happens
 * to live on the farm rather than on a player, and a stack dragged between
 * them merges or swaps by exactly the rules it would inside either one.
 *
 * Place-bound, unlike the crafting tab. Walking away closes it, because a
 * chest is somewhere you are standing — see `panelSurvivesStep` in the
 * reducer, where the stall, the anvil and this get the one rule between them.
 *
 * Nothing here decides anything. Two people can have the same chest open and
 * reach for the same stack; whichever intent lands first wins, and the other
 * sees the chest change under their cursor. No lock and no reservation, which
 * is the same answer every other shared thing on this farm gives.
 */
export default function ChestPanel() {
  const chest = useStore(farmStore, openChest);
  const player = useStore(farmStore, localPlayer);
  const mine = useStore(farmStore, (store) => inventorySlots(localPlayer(store)));

  const [dragging, setDragging] = useState<Ref | null>(null);
  const [over, setOver] = useState<Ref | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Escape is not read here: it means three different things depending on what
  // else is open, and that order is decided once, in the store. This only asks
  // for focus, so the panel is announced when it opens.
  useEffect(() => {
    if (chest) panel.current?.focus();
  }, [chest]);

  if (!chest || !player) return null;

  const close = () => sendAction({ type: 'closePanel' });

  const finishDrag = (to: Ref | null) => {
    if (dragging && to && !(to.side === dragging.side && to.slot === dragging.slot)) {
      sendAction({ type: 'chestMoveStack', chestId: chest.id, from: dragging, to });
    }
    setDragging(null);
    setOver(null);
  };

  const isOver = (side: Side, slot: number) =>
    over?.side === side &&
    over.slot === slot &&
    dragging !== null &&
    !(dragging.side === side && dragging.slot === slot);

  const grid = (side: Side, slots: Array<ItemStack | null>, size: number) => (
    <div className="inventory-slots is-chest">
      {Array.from({ length: size }, (_, index) => (
        <ChestSlot
          key={index}
          side={side}
          index={index}
          stack={slots[index] ?? null}
          dragging={dragging?.side === side && dragging.slot === index}
          dropTarget={isOver(side, index)}
          onDragStart={() => setDragging({ side, slot: index })}
          onDragEnter={() => setOver({ side, slot: index })}
          onDrop={() => finishDrag({ side, slot: index })}
          onDragEnd={() => finishDrag(null)}
        />
      ))}
    </div>
  );

  const label = ITEMS[chest.kind]?.label ?? 'Rương';
  const used = chest.contents.filter((slot) => slot !== null).length;

  return (
    <div className="inventory-overlay" role="presentation" onClick={close}>
      <div
        ref={panel}
        className="inventory-panel chest-panel"
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="inventory-header">
          <h2>{label}</h2>
          <span className="inventory-free">
            Đã dùng {used}/{chest.contents.length} ô
          </span>
          <button type="button" className="ghost-button" onClick={close}>
            Đóng
          </button>
        </header>

        <div className="chest-columns">
          <section aria-label="Túi của bạn">
            <h3 className="chest-heading">Túi của bạn</h3>
            {grid('player', mine, INVENTORY_SIZE)}
          </section>
          <section aria-label={label}>
            <h3 className="chest-heading">
              {label}
              <button
                type="button"
                className="ghost-button"
                onClick={() => sendAction({ type: 'chestStow', chestId: chest.id })}
              >
                Dồn hết vào
              </button>
            </h3>
            {grid('chest', chest.contents, chest.contents.length)}
          </section>
        </div>

        <p className="hud-note">
          Rương là của chung cả nông trại — ai cũng mở được, ai cũng lấy được. &ldquo;Dồn hết
          vào&rdquo; chỉ chuyển những thứ trong rương đã có sẵn một chồng, nên nó không nuốt mất
          cái cuốc của bạn. Đi xa khỏi rương là bảng tự đóng.
        </p>
      </div>
    </div>
  );
}

interface ChestSlotProps {
  side: Side;
  index: number;
  stack: ItemStack | null;
  dragging: boolean;
  dropTarget: boolean;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
}

function ChestSlot({
  side,
  index,
  stack,
  dragging,
  dropTarget,
  onDragStart,
  onDragEnter,
  onDrop,
  onDragEnd,
}: ChestSlotProps) {
  const def = stack ? ITEMS[stack.item] : null;
  const classes = ['inventory-slot'];
  if (dragging) classes.push('is-dragging');
  if (dropTarget) classes.push('is-target');

  const where = side === 'player' ? 'Túi' : 'Rương';
  const label = def
    ? `${where}, ô ${index + 1}: ${def.label}${stack && stack.count > 1 ? ` x${stack.count}` : ''}`
    : `${where}, ô ${index + 1}: trống`;

  return (
    <div
      className={classes.join(' ')}
      draggable={stack !== null}
      onDragStart={onDragStart}
      onDragOver={(event) => {
        // Without this the browser refuses the drop and nothing ever lands.
        event.preventDefault();
        onDragEnter();
      }}
      onDrop={(event) => {
        event.preventDefault();
        onDrop();
      }}
      onDragEnd={onDragEnd}
      role="button"
      tabIndex={0}
      aria-label={label}
      title={def ? [def.label, def.blurb].filter(Boolean).join('\n') : undefined}
    >
      {stack && def ? (
        <>
          <ItemIcon item={stack.item} size={30} />
          <span className="slot-count">{stack.count > 1 ? stack.count : ''}</span>
        </>
      ) : null}
    </div>
  );
}
