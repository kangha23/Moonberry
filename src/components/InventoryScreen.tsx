import { useRef, useState } from 'react';
import { useStore } from 'zustand';
import ItemIcon from './ItemIcon';
import { useDialogFocus } from './useDialogFocus';
import {
  freeSlotCount,
  inventorySlots,
  knownRecipeRows,
  localPlayer,
  readyRecipeCount,
  type RecipeRow,
} from '../game/state/selectors';
import { farmStore, sendAction, setInventoryOpen } from '../game/state/store';
import { HOTBAR_SIZE, INVENTORY_SIZE, type ItemStack } from '../game/systems/inventory';
import { ITEMS } from '../game/systems/items';

type Tab = 'bag' | 'crafting';

/**
 * The full inventory grid and the crafting bench that is not a bench.
 *
 * React rather than Phaser because both halves are documents: a grid of
 * labelled cells with drag-and-drop, and a list of rows with ingredients and
 * buttons. The DOM does all of that well and hands it to the keyboard and the
 * screen reader for nothing.
 *
 * Crafting lives here rather than at a workbench because spec 11 is explicit
 * about there not being one, and it is a tab rather than a place-bound panel
 * for the same reason: unlike the stall and the anvil, walking away from your
 * own satchel is not a thing you can do. That is why `'crafting'` is not a
 * `PanelId` — the two panels the server owns close when you step away, and
 * this one has nowhere to step away from.
 *
 * While it is open the scene takes no keyboard input — see `inventoryOpen` in
 * the store — so a drag can never also swing a hoe.
 */
export default function InventoryScreen() {
  const open = useStore(farmStore, (store) => store.inventoryOpen);
  const player = useStore(farmStore, localPlayer);
  const slots = useStore(farmStore, (store) => inventorySlots(localPlayer(store)));
  const free = useStore(farmStore, (store) => freeSlotCount(localPlayer(store)));
  const recipes = useStore(farmStore, (store) => knownRecipeRows(localPlayer(store)));
  const ready = useStore(farmStore, (store) => readyRecipeCount(localPlayer(store)));

  const [tab, setTab] = useState<Tab>('bag');
  const [dragging, setDragging] = useState<number | null>(null);
  const [over, setOver] = useState<number | null>(null);
  const panel = useRef<HTMLDivElement>(null);

  // A dialog rather than a picture of one: focus moves in on open, goes back
  // where it came from on close, and Tab stays inside while it is up. Escape
  // is not handled here — it means three different things depending on what
  // else is open, and that ladder is decided once, in the store.
  useDialogFocus(open, panel);

  if (!open || !player) return null;

  const finishDrag = (to: number | null) => {
    if (dragging !== null && to !== null && to !== dragging) {
      sendAction({ type: 'moveStack', from: dragging, to });
    }
    setDragging(null);
    setOver(null);
  };

  return (
    <div className="inventory-overlay" role="presentation" onClick={() => setInventoryOpen(false)}>
      <div
        ref={panel}
        className="inventory-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Túi đồ"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="inventory-header">
          <h2>{tab === 'bag' ? 'Túi đựng' : 'Chế tác'}</h2>
          <span className="inventory-free">
            {tab === 'bag'
              ? `Còn trống ${free}/${INVENTORY_SIZE} ô`
              : `Làm được ngay ${ready}/${recipes.length} công thức`}
          </span>
          <button type="button" className="ghost-button" onClick={() => setInventoryOpen(false)}>
            Đóng
          </button>
        </header>

        <div className="workshop-tabs" role="tablist" aria-label="Túi đồ hay chế tác">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'bag'}
            className={`ghost-button${tab === 'bag' ? ' is-active' : ''}`}
            onClick={() => setTab('bag')}
          >
            Túi đựng
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'crafting'}
            className={`ghost-button${tab === 'crafting' ? ' is-active' : ''}`}
            onClick={() => setTab('crafting')}
          >
            Chế tác{ready > 0 ? ` (${ready})` : ''}
          </button>
        </div>

        {tab === 'bag' ? (
          <>
            <div className="inventory-slots">
              {Array.from({ length: INVENTORY_SIZE }, (_, index) => {
                const stack = slots[index] ?? null;
                return (
                  <Slot
                    key={index}
                    index={index}
                    stack={stack}
                    selected={index === player.selectedSlot}
                    inHotbar={index < HOTBAR_SIZE}
                    dragging={dragging === index}
                    dropTarget={over === index && dragging !== null && dragging !== index}
                    onDragStart={() => setDragging(index)}
                    onDragEnter={() => setOver(index)}
                    onDrop={() => finishDrag(index)}
                    onDragEnd={() => finishDrag(null)}
                    onSelect={() => {
                      if (index < HOTBAR_SIZE) sendAction({ type: 'selectSlot', slot: index });
                    }}
                  />
                );
              })}
            </div>

            <p className="hud-note">
              {HOTBAR_SIZE} ô đầu tiên là thanh đồ nhanh — dải ngang dưới đáy màn hình chơi là cửa
              sổ nhìn vào chính chúng, không phải một cái túi thứ hai. Kéo một chồng đè lên chồng
              khác để gộp hoặc đổi chỗ. Túi đầy sẽ từ chối vụ thu hoạch và bỏ lại nông sản dưới
              đất, nên chuyến về nhà là một lựa chọn có giá.
            </p>
          </>
        ) : (
          <CraftingTab rows={recipes} />
        )}
      </div>
    </div>
  );
}

/**
 * Every recipe this player knows, and nothing they do not.
 *
 * A tab that also listed the twenty locked ones, greyed out, would read as a
 * catalogue of things being withheld. This one grows as the farm does. What is
 * greyed here is a recipe they know and cannot currently afford, which is a
 * shopping list rather than a tease — and the ingredient row says 34/50 rather
 * than "not enough wood", because the first is a number you can go and act on.
 */
function CraftingTab({ rows }: { rows: RecipeRow[] }) {
  if (rows.length === 0) {
    return (
      <p className="shop-empty">
        Chưa biết công thức nào. Kết thân với người trong làng, hoặc cứ sống thêm vài ngày nữa.
      </p>
    );
  }

  return (
    <>
      <ul className="shop-list">
        {rows.map((row) => (
          <li key={row.recipe.id} className={`shop-row${row.canMake ? '' : ' is-dim'}`}>
            <ItemIcon item={row.recipe.id} size={32} />
            <div className="shop-row-text">
              <strong>
                {row.label}
                {row.recipe.yields > 1 ? ` x${row.recipe.yields}` : ''}
              </strong>
              <small>{row.blurb}</small>
              <small className="recipe-needs">
                {row.ingredients.map((ingredient) => (
                  <span
                    key={ingredient.item}
                    className={`recipe-need${ingredient.has < ingredient.needs ? ' is-short' : ''}`}
                  >
                    <ItemIcon item={ingredient.item} size={16} />
                    {ITEMS[ingredient.item]?.label ?? ingredient.item} {ingredient.has}/
                    {ingredient.needs}
                  </span>
                ))}
              </small>
            </div>
            <div className="shop-buttons">
              <button
                type="button"
                className="ghost-button"
                disabled={!row.canMake}
                title={row.shortfall || undefined}
                onClick={() => sendAction({ type: 'craft', recipe: row.recipe.id, count: 1 })}
              >
                Làm
              </button>
            </div>
          </li>
        ))}
      </ul>
      <p className="hud-note">
        Không cần bàn thợ: đứng ở đâu cũng làm được. Thứ làm ra nằm trong túi — cầm nó lên tay rồi
        bấm vào một ô đất trống để đặt xuống, và cầm cuốc chim bấm vào nó để nhặt lại lên.
      </p>
    </>
  );
}

interface SlotProps {
  index: number;
  stack: ItemStack | null;
  selected: boolean;
  inHotbar: boolean;
  dragging: boolean;
  dropTarget: boolean;
  onDragStart: () => void;
  onDragEnter: () => void;
  onDrop: () => void;
  onDragEnd: () => void;
  onSelect: () => void;
}

function Slot({
  index,
  stack,
  selected,
  inHotbar,
  dragging,
  dropTarget,
  onDragStart,
  onDragEnter,
  onDrop,
  onDragEnd,
  onSelect,
}: SlotProps) {
  const def = stack ? ITEMS[stack.item] : null;
  const classes = ['inventory-slot'];
  if (inHotbar) classes.push('is-hotbar');
  if (selected) classes.push('is-selected');
  if (dragging) classes.push('is-dragging');
  if (dropTarget) classes.push('is-target');

  // Sells for, or costs — never both, because the stall does not do both for
  // anything: it buys produce and sells seed, and an item is one or the other.
  const price = def
    ? def.sellPrice > 0
      ? `bán được ${def.sellPrice}g`
      : def.buyPrice
        ? `giá ${def.buyPrice}g ngoài sạp`
        : ''
    : '';
  // The tooltip is the accessible name too, so hovering and tabbing tell the
  // same story rather than the mouse getting the better version.
  const label = def
    ? `Ô ${index + 1}: ${def.label}${stack && stack.count > 1 ? ` x${stack.count}` : ''}${
        stack?.charges !== undefined ? `, còn ${stack.charges}` : ''
      }${price ? `, ${price}` : ''}`
    : `Ô ${index + 1}: trống`;

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
      onClick={onSelect}
      role="button"
      tabIndex={0}
      aria-label={label}
      title={def ? [def.label, def.blurb, price].filter(Boolean).join('\n') : undefined}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onSelect();
        }
      }}
    >
      <span className="slot-index">{index + 1}</span>
      {stack && def ? (
        <>
          <ItemIcon item={stack.item} size={34} />
          <span className={`slot-count${stack.charges === 0 ? ' is-empty' : ''}`}>
            {stack.charges !== undefined ? stack.charges : stack.count > 1 ? stack.count : ''}
          </span>
        </>
      ) : null}
    </div>
  );
}
