import { useEffect, useRef, useState } from 'react';
import { useStore } from 'zustand';
import {
  ANIMAL_DEFS,
  ANIMAL_KINDS,
  HAY_PRICE,
  MAX_ANIMAL_NAME,
  heartsFor,
  resalePrice,
  type Animal,
  type AnimalKind,
} from '../game/systems/animals';
import {
  animalHouses,
  gradeLabel,
  hayCapacityOf,
  localPlayer,
  openPanel,
} from '../game/state/selectors';
import { farmStore, sendAction } from '../game/state/store';
import { itemDef } from '../game/systems/items';
import ItemIcon from './ItemIcon';

/** How many bales a button buys. A day's feed for a full barn, and a fortnight's. */
const HAY_LOTS = [10, 60] as const;

/**
 * Bram's counter: livestock on one tab, the herd you already own on the other.
 *
 * React rather than Phaser for the same reason as the stall and the forge —
 * it is rows with prices, a text field and buttons, and the DOM hands all
 * three to the keyboard and the screen reader for nothing. The one thing here
 * that no other panel has is a text input, because an animal gets a name, and
 * a name is the one value in this whole feature that genuinely originates on
 * the client.
 *
 * Nothing in this file decides anything. Rows grey out to save a wasted click;
 * the answer that counts comes back from the reducer.
 */
export default function RanchPanel() {
  const open = useStore(farmStore, (store) => openPanel(store) === 'ranch');
  const player = useStore(farmStore, localPlayer);
  const coins = useStore(farmStore, (store) => store.farm.coins);
  const day = useStore(farmStore, (store) => store.farm.time.day);
  const animals = useStore(farmStore, (store) => store.farm.animals);
  const houses = useStore(farmStore, (store) => animalHouses(store.farm));
  // Two numbers rather than one object: a selector that builds a fresh object
  // on every read re-renders on every read, which is a render loop.
  const hayHeld = useStore(farmStore, (store) => store.farm.hay);
  const hayCapacity = useStore(farmStore, (store) => hayCapacityOf(store.farm));
  const [tab, setTab] = useState<'buy' | 'herd'>('buy');
  const panel = useRef<HTMLDivElement>(null);

  // Escape steps away from the counter, but it is not read here: it means
  // three different things depending on what else is open, and that order is
  // decided once, in the store. This only asks for focus, so the panel is
  // announced when it opens and Escape lands somewhere sensible.
  useEffect(() => {
    if (open) panel.current?.focus();
  }, [open]);

  if (!open || !player) return null;

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
        aria-label="Bãi quây gia súc"
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="inventory-header">
          <h2>Bãi quây gia súc</h2>
          <span className="inventory-free">Ví chung của nông trại: {coins}g</span>
          <button
            type="button"
            className="ghost-button"
            onClick={() => sendAction({ type: 'closePanel' })}
          >
            Đóng
          </button>
        </header>

        <div className="workshop-tabs" role="tablist" aria-label="Mua gì">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'buy'}
            className={`ghost-button${tab === 'buy' ? ' is-active' : ''}`}
            onClick={() => setTab('buy')}
          >
            Mua về
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'herd'}
            className={`ghost-button${tab === 'herd' ? ' is-active' : ''}`}
            onClick={() => setTab('herd')}
          >
            Đàn của bạn ({animals.length})
          </button>
        </div>

        {tab === 'buy' ? (
          <BuyTab coins={coins} houses={houses} hay={{ held: hayHeld, capacity: hayCapacity }} />
        ) : (
          <HerdTab animals={animals} day={day} houses={houses} />
        )}
      </div>
    </div>
  );
}

type Houses = ReturnType<typeof animalHouses>;

/**
 * The counter proper: four animals, a house to put each one in, and hay.
 *
 * A house with room is what every row depends on, so the absence of one is
 * said once at the top rather than four times in four disabled buttons.
 */
function BuyTab({
  coins,
  houses,
  hay,
}: {
  coins: number;
  houses: Houses;
  hay: { held: number; capacity: number };
}) {
  const [name, setName] = useState('');
  const [home, setHome] = useState<string>('');

  // The chosen house, kept honest against a list that can change underneath it
  // — somebody else's barn can finish while this panel is open.
  const chosen = houses.find((house) => house.id === home) ?? null;

  return (
    <>
      {houses.length === 0 ? (
        <p className="shop-empty">
          Chưa có chuồng nào dựng xong. Bram không bán gà cho người chưa có chỗ nhốt — ra lò rèn đặt
          một cái chuồng gà đã.
        </p>
      ) : (
        <>
          <div className="ranch-form">
            <label className="ranch-field">
              <span>Đặt tên</span>
              <input
                type="text"
                value={name}
                maxLength={MAX_ANIMAL_NAME}
                placeholder="Mun, Sữa, Bé Út…"
                onChange={(event) => setName(event.target.value)}
              />
            </label>
            <label className="ranch-field">
              <span>Thả vào</span>
              <select value={home} onChange={(event) => setHome(event.target.value)}>
                <option value="">Chọn chuồng…</option>
                {houses.map((house) => (
                  <option key={house.id} value={house.id}>
                    {house.label} — {house.taken}/{house.capacity}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <ul className="shop-list">
            {ANIMAL_KINDS.map((kind) => {
              const def = ANIMAL_DEFS[kind];
              const tooDear = def.price > coins;
              // Every reason this row would be refused, asked here so the
              // button can say why rather than simply not working.
              const wrongHouse = chosen !== null && chosen.kind !== def.house;
              const full = chosen !== null && chosen.taken >= chosen.capacity;
              const noName = name.trim().length === 0;
              const produce = itemDef(def.produce);

              return (
                <li key={kind} className="shop-row">
                  <ItemIcon item={def.produce} size={32} />
                  <div className="shop-row-text">
                    <strong>{def.label}</strong>
                    <small>
                      {produce.label} mỗi {def.cycleDays === 1 ? 'ngày' : `${def.cycleDays} ngày`} •{' '}
                      bán {produce.sellPrice}g • ở {def.house === 'coop' ? 'chuồng gà' : 'chuồng lớn'}
                    </small>
                    <small>{def.blurb}</small>
                    {wrongHouse ? (
                      <small className="shop-warning">
                        {def.label} không ở {chosen.label.toLowerCase()} được.
                      </small>
                    ) : null}
                    {full ? (
                      <small className="shop-warning">{chosen.label} đã đầy.</small>
                    ) : null}
                  </div>
                  <span className="shop-price">{def.price}g</span>
                  <div className="shop-buttons">
                    <button
                      type="button"
                      className="ghost-button"
                      disabled={tooDear || !chosen || wrongHouse || full || noName}
                      onClick={() => {
                        if (!chosen) return;
                        sendAction({
                          type: 'buyAnimal',
                          kind: kind as AnimalKind,
                          home: chosen.id,
                          name: name.trim(),
                        });
                        setName('');
                      }}
                    >
                      Mua về
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      <HayRow coins={coins} hay={hay} />

      <p className="hud-note">
        Gia súc thuộc về nông trại, không thuộc về ai: ai ra chuồng trước thì người đó thu. Cho ăn
        là tự động, chừng nào kho cỏ còn cỏ — và kho cỏ là thứ phải dựng trước khi mua con vật đầu
        tiên.
      </p>
    </>
  );
}

/**
 * Hay, in its own row under the animals.
 *
 * The only purchase in the game that can be refused for having nowhere to put
 * it, so the row leads with the silo rather than with the price.
 *
 * Since spec 10 it is also the only purchase with a free alternative: a scythe
 * through a field of grass fills the same silo for nothing. That is said in
 * the row rather than left to be discovered, because a counter that sells you
 * something you could have cut yourself is a counter that feels like a trap
 * the moment you find out.
 */
function HayRow({ coins, hay }: { coins: number; hay: { held: number; capacity: number } }) {
  const noSilo = hay.capacity === 0;
  return (
    <ul className="shop-list">
      {/* `is-plain`, because a bale of hay is not an item and so has no icon
          cell: the four-column row would leave the picture column empty and
          squeeze the words into what is left. */}
      <li className={`shop-row is-plain${noSilo ? ' is-late' : ''}`}>
        <div className="shop-row-text">
          <strong>Cỏ khô</strong>
          <small>
            {noSilo ? 'Chưa có kho cỏ nào trên nông trại.' : `Kho cỏ: ${hay.held}/${hay.capacity} bó`}
          </small>
          <small>Mỗi con ăn một bó mỗi sáng, tự động rút từ kho.</small>
          <small>Cắt cỏ ngoài đồng bằng liềm cũng đổ vào đây, và không tốn gì.</small>
        </div>
        <span className="shop-price">{HAY_PRICE}g</span>
        <div className="shop-buttons">
          {HAY_LOTS.map((lot) => (
            <button
              key={lot}
              type="button"
              className="ghost-button"
              disabled={noSilo || HAY_PRICE * lot > coins || hay.held + lot > hay.capacity}
              onClick={() => sendAction({ type: 'buyHay', count: lot })}
            >
              Mua {lot}
            </button>
          ))}
        </div>
      </li>
    </ul>
  );
}

/**
 * The herd, as a ledger.
 *
 * It exists for one reason beyond vanity: selling. Everything else about an
 * animal is done by walking up to it, and should be — but a coop full of the
 * wrong bird is a decision somebody needs a list to undo.
 */
function HerdTab({
  animals,
  day,
  houses,
}: {
  animals: readonly Animal[];
  day: number;
  houses: Houses;
}) {
  if (animals.length === 0) {
    return (
      <p className="shop-empty">
        Nông trại chưa có con nào. Sang tab bên cạnh, chọn chuồng, và đặt cho nó một cái tên.
      </p>
    );
  }

  return (
    <>
      <ul className="shop-list">
        {animals.map((animal) => {
          const def = ANIMAL_DEFS[animal.kind];
          const house = houses.find((candidate) => candidate.id === animal.home);
          const hearts = heartsFor(animal.affection);
          return (
            <li key={animal.id} className="shop-row">
              <ItemIcon item={def.produce} size={32} />
              <div className="shop-row-text">
                <strong>
                  {animal.name} {hearts > 0 ? '♥'.repeat(hearts) : ''}
                </strong>
                <small>
                  {def.label} • {house?.label ?? 'không rõ chuồng'} • {day - animal.bornOnDay} ngày
                  tuổi
                </small>
                <small>Đang cho {gradeLabel(animal)}.</small>
              </div>
              <span className="shop-price">{resalePrice(animal.kind)}g</span>
              <div className="shop-buttons">
                <button
                  type="button"
                  className="ghost-button"
                  onClick={() => sendAction({ type: 'sellAnimal', animalId: animal.id })}
                >
                  Bán lại
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="hud-note">
        Bram mua lại đúng nửa giá. Nghe thì tàn nhẫn, nhưng không có đường ra thì một chuồng đầy gà
        là một quyết định vĩnh viễn.
      </p>
    </>
  );
}
