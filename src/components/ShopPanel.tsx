import { useEffect, useRef } from 'react';
import { useStore } from 'zustand';
import ItemIcon from './ItemIcon';
import { CROP_DEFINITIONS, listSeasons } from '../game/systems/farming';
import { countItem, hasRoomFor } from '../game/systems/inventory';
import { ITEMS } from '../game/systems/items';
import { daysLeftInSeason } from '../game/systems/time';
import { localPlayer, openPanel, stockFor } from '../game/state/selectors';
import { seasonLabel } from '../game/systems/time';
import { farmStore, sendAction } from '../game/state/store';

/** How many a single button buys. One, and a handful. */
const BULK = 5;

/**
 * The market stall's seed counter, drawn over the canvas.
 *
 * React rather than Phaser for the same reason as the satchel: it is a list of
 * rows with prices, buttons and tooltips, and the DOM gives all three to the
 * keyboard and the screen reader for free.
 *
 * It shows what the *season* stocks rather than a fixed list, so a crop added
 * to the catalogue appears here on its own. Nothing in this file decides
 * whether a purchase is allowed — the buttons grey out to save a wasted click,
 * but the answer that counts comes back from the reducer.
 */
export default function ShopPanel() {
  const open = useStore(farmStore, (store) => openPanel(store) === 'market');
  const player = useStore(farmStore, localPlayer);
  const coins = useStore(farmStore, (store) => store.farm.coins);
  const season = useStore(farmStore, (store) => store.farm.season);
  const day = useStore(farmStore, (store) => store.farm.time.day);
  const stock = useStore(farmStore, stockFor);
  const panel = useRef<HTMLDivElement>(null);

  // Escape steps away from the counter, but it is not read here: it means
  // three different things depending on what else is open, and that order is
  // decided once, in the store. This only asks for focus, so the panel is
  // announced when it opens and Escape lands somewhere sensible.
  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);

  if (!open || !player) return null;

  const left = daysLeftInSeason(day);
  // Asked of the seeds alone. The stall carries a tool all year round, so
  // `stock.length` stopped being the same question as "is there anything to
  // plant" the moment the golden scythe went on the counter.
  const seeds = stock.filter((entry) => entry.kind === 'seed');

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
        aria-label={`Sạp chợ, mùa ${seasonLabel(season)}`}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="inventory-header">
          <h2>Sạp chợ — mùa {seasonLabel(season)}</h2>
          <span className="inventory-free">Ví chung của nông trại: {coins}g</span>
          <button
            type="button"
            className="ghost-button"
            onClick={() => sendAction({ type: 'closePanel' })}
          >
            Đóng
          </button>
        </header>

        {seeds.length === 0 ? (
          <p className="shop-empty">
            Mùa {seasonLabel(season)} gieo gì cũng không sống đến ngày thu hoạch. Chỉ còn nông cụ trên quầy.
          </p>
        ) : null}
        {stock.length > 0 ? (
          <ul className="shop-list">
            {stock.map((entry) => {
              const held = countItem(player.inventory, entry.item);
              // Two reasons a row can refuse, and the player should be able to
              // see which before spending a click on it.
              const tooDear = entry.price > coins;
              const noRoom = !hasRoomFor(player.inventory, entry.item);

              // The stall's other half. A tool is one to a farmhand and has no
              // season and no growing time, so it gets its own row rather than
              // a seed row with three empty fields in it.
              if (entry.kind === 'tool') {
                const owned = held > 0;
                return (
                  <li key={entry.item} className="shop-row">
                    <ItemIcon item={entry.item} size={32} />
                    <div className="shop-row-text">
                      <strong>{entry.label}</strong>
                      <small>{entry.blurb}</small>
                      {owned ? <small className="shop-warning">Bạn đã có một cái rồi.</small> : null}
                    </div>
                    <span className="shop-price">{entry.price}g</span>
                    <div className="shop-buttons">
                      <button
                        type="button"
                        className="ghost-button"
                        disabled={tooDear || noRoom || owned}
                        onClick={() => sendAction({ type: 'buy', item: entry.item, count: 1 })}
                      >
                        Mua
                      </button>
                    </div>
                  </li>
                );
              }

              const crop = ITEMS[entry.item].plants!;
              const { growDays, regrowDays } = CROP_DEFINITIONS[crop];
              // The judgement this whole spec exists to make interesting: is
              // there time for another cycle before the season turns?
              const tooLate = growDays > left;

              return (
                <li key={entry.item} className={`shop-row${tooLate ? ' is-late' : ''}`}>
                  <ItemIcon item={entry.item} size={32} />
                  <div className="shop-row-text">
                    <strong>{ITEMS[entry.item].label}</strong>
                    <small>
                      {growDays} ngày thì chín
                      {regrowDays === null
                        ? ', rồi nhổ bỏ'
                        : `, rồi cứ ${regrowDays} ngày một lứa`}
                      {' • '}
                      Mùa {listSeasons(crop)}
                      {held > 0 ? ` • có ${held} trong túi` : ''}
                    </small>
                    {tooLate ? (
                      <small className="shop-warning">
                        Chỉ còn {left} ngày — cây này sẽ không kịp chín.
                      </small>
                    ) : null}
                  </div>
                  <span className="shop-price">{entry.price}g</span>
                  <div className="shop-buttons">
                    <button
                      type="button"
                      className="ghost-button"
                      disabled={tooDear || noRoom}
                      onClick={() => sendAction({ type: 'buy', item: entry.item, count: 1 })}
                    >
                      Mua 1
                    </button>
                    <button
                      type="button"
                      className="ghost-button"
                      disabled={entry.price * BULK > coins || !hasRoomFor(player.inventory, entry.item, BULK)}
                      onClick={() => sendAction({ type: 'buy', item: entry.item, count: BULK })}
                    >
                      Mua {BULK}
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}

        <p className="hud-note">
          Hạt giống mua bằng ví chung của nông trại và rơi vào túi của bạn. Cây chết khi giao mùa,
          nên câu hỏi ở cái sạp này luôn là: còn kịp một lứa nữa không. Mùa {seasonLabel(season)} còn{' '}
          {left} ngày.
        </p>
      </div>
    </div>
  );
}
