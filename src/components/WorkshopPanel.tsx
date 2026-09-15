import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import ItemIcon from './ItemIcon';
import { BUILDING_DEFS, BUILDING_KINDS, type BuildingKind } from '../game/systems/buildings';
import { localPlayer, openPanel, upgradeIsReady, upgradeOffers } from '../game/state/selectors';
import { farmStore, sendAction, setBuildKind } from '../game/state/store';
import { ITEMS } from '../game/systems/items';
import { UPGRADE_DAYS } from '../game/state/types';

type Tab = 'tools' | 'buildings';

/**
 * The blacksmith's counter: tools on one tab, buildings on the other.
 *
 * Both halves of the ratchet in one place, because both are the same errand —
 * you walk to the village with money and come back with the farm able to do
 * something it could not do yesterday. React rather than Phaser for the same
 * reason as the stall: it is a list of rows with prices and buttons, and the
 * DOM hands all of it to the keyboard and the screen reader for free.
 *
 * Nothing here decides anything. Buttons grey out to save a wasted click, and
 * the answer that counts comes back from the reducer.
 */
export default function WorkshopPanel() {
  const open = useStore(farmStore, (store) => openPanel(store) === 'workshop');
  const player = useStore(farmStore, localPlayer);
  const coins = useStore(farmStore, (store) => store.farm.coins);
  const day = useStore(farmStore, (store) => store.farm.time.day);
  const offers = useStore(farmStore, (store) => upgradeOffers(localPlayer(store)));
  const ready = useStore(farmStore, (store) => upgradeIsReady(localPlayer(store), store.farm.time.day));
  const [tab, setTab] = useState<Tab>('tools');
  const panel = useRef<HTMLDivElement>(null);

  // Escape steps away from the counter, but it is not read here: it means
  // three different things depending on what else is open, and that order is
  // decided once, in the store. This only asks for focus, so the panel is
  // announced when it opens and Escape lands somewhere sensible.
  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);

  if (!open || !player) return null;

  const pending = player.pendingUpgrade;

  /**
   * Choosing a building arms the cursor and shuts the panel, because the spot
   * is chosen on the farm rather than over a counter in the village. The walk
   * back is the point: you are picking a place in a field you know.
   */
  const startBuilding = (kind: BuildingKind) => {
    setBuildKind(kind);
    sendAction({ type: 'closePanel' });
  };

  return (
    <div
      className="inventory-overlay"
      role="presentation"
      onClick={() => sendAction({ type: 'closePanel' })}
    >
      <div
        ref={panel}
        className="inventory-panel shop-panel"
        role="dialog"
        aria-modal="true"
        aria-label="Thợ rèn và thợ mộc"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="inventory-header">
          <h2>Lò rèn</h2>
          <span className="inventory-free">Ví chung của nông trại: {coins}g</span>
          <button
            type="button"
            className="ghost-button"
            onClick={() => sendAction({ type: 'closePanel' })}
          >
            Đóng
          </button>
        </header>

        <div className="workshop-tabs" role="tablist" aria-label="Đặt làm gì">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'tools'}
            className={`ghost-button${tab === 'tools' ? ' is-active' : ''}`}
            onClick={() => setTab('tools')}
          >
            Nông cụ
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'buildings'}
            className={`ghost-button${tab === 'buildings' ? ' is-active' : ''}`}
            onClick={() => setTab('buildings')}
          >
            Công trình
          </button>
        </div>

        {tab === 'tools' ? (
          <ToolsTab
            coins={coins}
            day={day}
            offers={offers}
            pending={pending}
            ready={ready}
          />
        ) : (
          <BuildingsTab coins={coins} onChoose={startBuilding} />
        )}
      </div>
    </div>
  );
}

function ToolsTab({
  coins,
  day,
  offers,
  pending,
  ready,
}: {
  coins: number;
  day: number;
  offers: ReturnType<typeof upgradeOffers>;
  pending: { item: string; readyOnDay: number } | null;
  ready: boolean;
}) {
  // One anvil, one tool at a time. While something is on it the list is not a
  // list of things you could order, it is a thing you are waiting for.
  if (pending) {
    const label = ITEMS[pending.item]?.label ?? pending.item;
    const left = pending.readyOnDay - day;
    return (
      <>
        <ul className="shop-list">
          <li className="shop-row">
            <ItemIcon item={pending.item} size={32} />
            <div className="shop-row-text">
              <strong>{label}</strong>
              <small>
                {ready
                  ? 'Đã xong, đang nằm chờ trên bàn.'
                  : `Xong vào ngày ${pending.readyOnDay} — còn ${left} ngày nữa.`}
              </small>
            </div>
            <div className="shop-buttons">
              <button
                type="button"
                className="ghost-button"
                disabled={!ready}
                onClick={() => sendAction({ type: 'collectTool' })}
              >
                Nhận về
              </button>
            </div>
          </li>
        </ul>
        <p className="hud-note">
          Thợ rèn chỉ làm một món một lúc. Thứ bạn giao đi coi như mất cho đến khi bạn quay lại lấy,
          và đó chính là toàn bộ cái giá của một lần nâng cấp — những ngày bạn sống thiếu nó.
        </p>
      </>
    );
  }

  if (offers.length === 0) {
    return (
      <p className="shop-empty">
        Trong túi không có gì thợ rèn có thể làm tốt hơn. Hãy mang tới một cái cuốc, bình tưới hay
        giỏ thu hoạch chưa phải loại tốt nhất ông ấy làm được.
      </p>
    );
  }

  return (
    <>
      <ul className="shop-list">
        {offers.map((offer) => {
          const into = ITEMS[offer.into];
          const tooDear = offer.cost > coins;
          return (
            <li key={offer.item} className="shop-row">
              <ItemIcon item={offer.into} size={32} />
              <div className="shop-row-text">
                <strong>{offer.intoLabel}</strong>
                <small>
                  Từ {offer.label.toLowerCase()} của bạn • {into.blurb}
                </small>
                <small className="shop-warning">
                  Thợ rèn giữ nó {UPGRADE_DAYS} ngày.
                </small>
              </div>
              <span className="shop-price">{offer.cost}g</span>
              <div className="shop-buttons">
                <button
                  type="button"
                  className="ghost-button"
                  disabled={tooDear}
                  onClick={() => sendAction({ type: 'upgradeTool', item: offer.item })}
                >
                  Giao cho thợ rèn
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="hud-note">
        Nông cụ tốt hơn làm được cả một mảng ô chỉ trong một nhát, mà lại đỡ tốn sức hơn. Cái giá là
        {' '}{UPGRADE_DAYS} ngày bạn sống thiếu món đã giao đi.
      </p>
    </>
  );
}

function BuildingsTab({
  coins,
  onChoose,
}: {
  coins: number;
  onChoose: (kind: BuildingKind) => void;
}) {
  return (
    <>
      <ul className="shop-list">
        {BUILDING_KINDS.map((kind) => {
          const def = BUILDING_DEFS[kind];
          const tooDear = def.cost > coins;
          return (
            <li key={kind} className="shop-row is-plain">
              <div className="shop-row-text">
                <strong>{def.label}</strong>
                <small>
                  {def.width}x{def.height} ô • xây trong {def.days} ngày
                </small>
                <small>{def.blurb}</small>
              </div>
              <span className="shop-price">{def.cost}g</span>
              <div className="shop-buttons">
                <button
                  type="button"
                  className="ghost-button"
                  disabled={tooDear}
                  onClick={() => onChoose(kind)}
                >
                  Chọn chỗ
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="hud-note">
        Chọn một cái sẽ đưa bạn về nông trại với cái nền móng dính theo con trỏ. Chưa trả đồng nào
        cho đến khi bạn bấm chọn chỗ, và chỗ đó phải là đất trống — không ao, không cây, không
        còn cây trồng dưới đất.
      </p>
    </>
  );
}
