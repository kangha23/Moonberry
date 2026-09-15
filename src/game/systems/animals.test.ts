import { describe, expect, it } from 'vitest';
import {
  ANIMAL_DEFS,
  ANIMAL_KINDS,
  HUNGRY_AFFECTION,
  MAX_AFFECTION,
  MIN_PRODUCE_AFFECTION,
  OUTDOORS_AFFECTION,
  PET_AFFECTION,
  SILO_CAPACITY,
  STARTING_AFFECTION,
  advanceAnimals,
  animalAtTile,
  animalsIn,
  capacityOf,
  checkPurchase,
  collectProduce,
  createAnimal,
  feedAnimal,
  gradeFor,
  hasProduce,
  hayCapacity,
  housePoint,
  isAnimalHouse,
  nearestAnimal,
  nextAnimalId,
  petAnimal,
  resalePrice,
  startAnimalDay,
  wanderTarget,
  type Animal,
  type AnimalKind,
} from './animals';
import { BUILDING_DEFS, type Building } from './buildings';
import { createInventory, countItem } from './inventory';
import { gradedIdFor, itemDef } from './items';
import { createTimeState } from './time';

function building(kind: Building['kind'], id = 'b1', overrides: Partial<Building> = {}): Building {
  return { id, kind, x: 6, y: 6, readyOnDay: null, doorOpen: false, ...overrides };
}

function animal(kind: AnimalKind = 'chicken', overrides: Partial<Animal> = {}): Animal {
  return { ...createAnimal([], kind, 'b1', 'Mun', 1), ...overrides };
}

describe('the catalogue', () => {
  it('houses every animal somewhere that actually holds animals', () => {
    for (const kind of ANIMAL_KINDS) {
      const house = ANIMAL_DEFS[kind].house;
      expect(isAnimalHouse(house), `${kind} lives in a ${house}, which holds nothing`).toBe(true);
      expect(capacityOf(house)).toBeGreaterThan(0);
    }
  });

  it('names produce that the item table knows about, at every grade', () => {
    // A catalogue row naming an item nobody defined would throw the first time
    // an egg was collected, which is a week into a save rather than in a test.
    for (const kind of ANIMAL_KINDS) {
      for (const grade of ['normal', 'good', 'fine'] as const) {
        const id = gradedIdFor(ANIMAL_DEFS[kind].produce, grade);
        expect(() => itemDef(id), `${kind} at ${grade}`).not.toThrow();
        expect(itemDef(id).produce, `${id} is not something the stall buys`).toBe(true);
      }
    }
  });

  it('prices every animal above a season of what it gives', () => {
    // The herd is meant to be slower than a field and steadier than one. An
    // animal that paid for itself in a week would make the fields pointless.
    for (const kind of ANIMAL_KINDS) {
      const def = ANIMAL_DEFS[kind];
      const perDay = itemDef(def.produce).sellPrice / def.cycleDays;
      expect(def.price / perDay, `${kind} pays for itself too fast`).toBeGreaterThan(14);
    }
  });

  it('buys back at exactly half, rounded down', () => {
    for (const kind of ANIMAL_KINDS) {
      expect(resalePrice(kind)).toBe(Math.floor(ANIMAL_DEFS[kind].price / 2));
    }
  });
});

describe('affection and grade', () => {
  it('follows the table at every boundary', () => {
    expect(gradeFor(199)).toBeNull();
    expect(gradeFor(200)).toBe('normal');
    expect(gradeFor(599)).toBe('normal');
    expect(gradeFor(600)).toBe('good');
    expect(gradeFor(849)).toBe('good');
    expect(gradeFor(850)).toBe('fine');
    expect(gradeFor(MAX_AFFECTION)).toBe('fine');
  });

  it('pays the better grades what the item table says they are worth', () => {
    const ordinary = itemDef(gradedIdFor('egg', 'normal')).sellPrice;
    expect(itemDef(gradedIdFor('egg', 'good')).sellPrice).toBe(Math.round(ordinary * 1.25));
    expect(itemDef(gradedIdFor('egg', 'fine')).sellPrice).toBe(Math.round(ordinary * 1.5));
  });

  it('starts an animal in the ordinary band, so a purchase gives something at once', () => {
    expect(STARTING_AFFECTION).toBe(MIN_PRODUCE_AFFECTION);
    expect(gradeFor(createAnimal([], 'cow', 'b1', 'Sữa', 3).affection)).toBe('normal');
  });
});

describe('petting', () => {
  it('adds affection once, and refuses the second stroke of the day', () => {
    const first = petAnimal(animal());
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    expect(first.animal.affection).toBe(STARTING_AFFECTION + PET_AFFECTION);
    expect(first.animal.pettedToday).toBe(true);

    const second = petAnimal(first.animal);
    expect(second.ok).toBe(false);
  });

  it('never carries affection past the ceiling', () => {
    const full = petAnimal(animal('goat', { affection: MAX_AFFECTION }));
    expect(full.ok).toBe(true);
    if (full.ok) expect(full.animal.affection).toBe(MAX_AFFECTION);
  });
});

describe('collecting', () => {
  it('gives the grade the affection has earned', () => {
    for (const [affection, grade] of [
      [200, 'normal'],
      [700, 'good'],
      [900, 'fine'],
    ] as const) {
      const result = collectProduce(animal('cow', { affection, produceOnDay: 1 }), createInventory(), 3);
      expect(result.ok).toBe(true);
      if (!result.ok) continue;
      expect(result.grade).toBe(grade);
      expect(result.item).toBe(gradedIdFor('milk', grade));
      expect(countItem(result.inventory, result.item)).toBe(1);
    }
  });

  it('gives nothing at all below the first threshold', () => {
    const sullen = animal('chicken', { affection: MIN_PRODUCE_AFFECTION - 1, produceOnDay: 1 });
    expect(hasProduce(sullen, 9)).toBe(false);
    expect(collectProduce(sullen, createInventory(), 9).ok).toBe(false);
  });

  it('moves the clock on before anything reaches the satchel, so only one person gets it', () => {
    // The race two farmhands can actually run: both walk to the coop, both
    // press the key. The first collection is what makes the second refuse.
    const hen = animal('chicken', { produceOnDay: 4 });
    const first = collectProduce(hen, createInventory(), 4);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = collectProduce(first.animal, createInventory(), 4);
    expect(second.ok).toBe(false);
    expect(first.animal.produceOnDay).toBe(4 + ANIMAL_DEFS.chicken.cycleDays);
  });

  it('refuses rather than dropping the produce when the satchel is full', () => {
    const full = createInventory().map(() => ({ item: 'wood', count: 99 }));
    const result = collectProduce(animal('cow', { produceOnDay: 1 }), full, 5);
    expect(result.ok).toBe(false);
  });
});

describe('the morning', () => {
  it('feeds from the silo and produces the next day', () => {
    const hen = animal('chicken', { fedToday: true, produceOnDay: 2 });
    const rolled = startAnimalDay([hen], 4, 2);

    expect(rolled.hay).toBe(3);
    expect(rolled.hungry).toBe(0);
    expect(rolled.animals[0].fedToday).toBe(true);
    expect(hasProduce(rolled.animals[0], 2)).toBe(true);
  });

  it('takes affection and the day’s produce from an animal that went hungry', () => {
    const hen = animal('chicken', { fedToday: false, produceOnDay: 2, affection: 500 });
    const rolled = startAnimalDay([hen], 0, 2);

    expect(rolled.hungry).toBe(1);
    expect(rolled.animals[0].affection).toBe(500 - HUNGRY_AFFECTION);
    expect(hasProduce(rolled.animals[0], 2)).toBe(false);
    // Pushed by a day rather than reset, so one lean night does not cost a
    // goat its whole two-day cycle.
    expect(rolled.animals[0].produceOnDay).toBe(3);
  });

  it('never starves an animal to death, however long the neglect runs', () => {
    let herd = [animal('cow', { fedToday: false })];
    for (let day = 2; day < 40; day += 1) herd = startAnimalDay(herd, 0, day).animals;

    expect(herd).toHaveLength(1);
    expect(herd[0].affection).toBe(0);
  });

  it('pays for a day spent out of doors, and clears the day’s flags', () => {
    const grazed = animal('goat', { outsideToday: true, pettedToday: true, affection: 300 });
    const rolled = startAnimalDay([grazed], 2, 5);

    expect(rolled.animals[0].affection).toBe(300 + OUTDOORS_AFFECTION);
    expect(rolled.animals[0].pettedToday).toBe(false);
    expect(rolled.animals[0].outsideToday).toBe(false);
    // Everybody wakes up indoors, exactly as the villagers wake at their doors.
    expect(rolled.animals[0].position).toBeNull();
  });

  it('feeds as many as the silo holds and no more', () => {
    const herd = [animal('chicken'), animal('chicken'), animal('chicken')].map((each, index) => ({
      ...each,
      id: `a${index + 1}`,
      fedToday: true,
    }));
    const rolled = startAnimalDay(herd, 2, 6);

    expect(rolled.animals.map((each) => each.fedToday)).toEqual([true, true, false]);
    expect(rolled.hay).toBe(0);
  });
});

describe('hay', () => {
  it('holds nothing without a silo, and a silo’s worth with one', () => {
    expect(hayCapacity([])).toBe(0);
    expect(hayCapacity([building('coop')])).toBe(0);
    expect(hayCapacity([building('silo')])).toBe(SILO_CAPACITY);
    expect(hayCapacity([building('silo', 'b1'), building('silo', 'b2')])).toBe(SILO_CAPACITY * 2);
  });

  it('does not count a silo that is still a scaffold', () => {
    expect(hayCapacity([building('silo', 'b1', { readyOnDay: 9 })])).toBe(0);
  });

  it('feeds by hand only when there is hay and the animal has not eaten', () => {
    expect(feedAnimal(animal('cow', { fedToday: false }), 0).ok).toBe(false);
    expect(feedAnimal(animal('cow', { fedToday: true }), 5).ok).toBe(false);

    const fed = feedAnimal(animal('cow', { fedToday: false }), 5);
    expect(fed.ok).toBe(true);
    if (fed.ok) {
      expect(fed.animal.fedToday).toBe(true);
      expect(fed.hay).toBe(4);
    }
  });
});

describe('buying', () => {
  const coop = building('coop', 'b1');
  const barn = building('barn', 'b2', { x: 14, y: 6 });

  it('takes an animal into the right house', () => {
    expect(checkPurchase([], [coop], 'chicken', 'b1', 'Mun').ok).toBe(true);
    expect(checkPurchase([], [barn], 'cow', 'b2', 'Sữa').ok).toBe(true);
  });

  it('refuses a house of the wrong sort', () => {
    expect(checkPurchase([], [coop, barn], 'cow', 'b1', 'Sữa').ok).toBe(false);
    expect(checkPurchase([], [coop, barn], 'duck', 'b2', 'Vịt').ok).toBe(false);
  });

  it('refuses a house that is not built yet', () => {
    const scaffold = building('coop', 'b1', { readyOnDay: 8 });
    expect(checkPurchase([], [scaffold], 'chicken', 'b1', 'Mun').ok).toBe(false);
  });

  it('refuses a house with nobody’s room left in it', () => {
    const full = Array.from({ length: capacityOf('coop') }, (_, index) => ({
      ...animal('chicken'),
      id: `a${index + 1}`,
    }));
    expect(animalsIn(full, 'b1')).toHaveLength(capacityOf('coop'));
    expect(checkPurchase(full, [coop], 'chicken', 'b1', 'Mun').ok).toBe(false);
  });

  it('refuses a house the farm does not have', () => {
    expect(checkPurchase([], [coop], 'chicken', 'b9', 'Mun').ok).toBe(false);
  });

  it('refuses a name that is not one', () => {
    expect(checkPurchase([], [coop], 'chicken', 'b1', '   ').ok).toBe(false);
    expect(checkPurchase([], [coop], 'chicken', 'b1', '').ok).toBe(false);
    expect(checkPurchase([], [coop], 'chicken', 'b1', 42).ok).toBe(false);
  });

  it('hands out ids that stay unique after something is sold', () => {
    const herd = [animal('chicken', { id: 'a1' }), animal('chicken', { id: 'a2' })];
    expect(nextAnimalId(herd)).toBe('a3');
    // The reason this takes the maximum rather than the length: animals leave.
    expect(nextAnimalId(herd.slice(1))).toBe('a3');
  });
});

describe('wandering', () => {
  const coop = building('coop', 'b1', { doorOpen: true });
  const noon = createTimeState(4, 12 * 60);

  it('is a pure function of the animal and the clock', () => {
    const home = housePoint(coop);
    const hen = animal('chicken', { id: 'a7' });

    // The whole reason the reducer may not call `Math.random`: two clients
    // simulating the same farm have to draw the same herd in the same places
    // without a byte crossing the wire to say so.
    expect(wanderTarget(hen, home, 900)).toEqual(wanderTarget(hen, home, 900));
    expect(wanderTarget(hen, home, 900)).not.toEqual(wanderTarget(hen, home, 3000));
    expect(wanderTarget(hen, home, 900)).not.toEqual(
      wanderTarget({ ...hen, id: 'a8' }, home, 900),
    );
  });

  it('puts them out of the door on a dry afternoon, and marks the day as spent outside', () => {
    const walked = advanceAnimals([animal()], [coop], [], [], 'Sunny', noon, 10);
    expect(walked[0].position).not.toBeNull();
    expect(walked[0].outsideToday).toBe(true);
  });

  it('keeps them in when the door is shut, when it rains, and after six', () => {
    const shut = building('coop', 'b1', { doorOpen: false });
    expect(advanceAnimals([animal()], [shut], [], [], 'Sunny', noon, 10)[0].position).toBeNull();
    expect(advanceAnimals([animal()], [coop], [], [], 'Drizzle', noon, 10)[0].position).toBeNull();

    const evening = createTimeState(4, 19 * 60);
    expect(advanceAnimals([animal()], [coop], [], [], 'Sunny', evening, 10)[0].position).toBeNull();
  });

  it('sends an animal that was out back inside when the hour comes', () => {
    const out = advanceAnimals([animal()], [coop], [], [], 'Sunny', noon, 10);
    const evening = createTimeState(4, 18 * 60);
    const home = advanceAnimals(out, [coop], [], [], 'Sunny', evening, 10);

    expect(home[0].position).toBeNull();
    // It still got its afternoon, and still gets paid for it at dawn.
    expect(home[0].outsideToday).toBe(true);
  });

  it('returns the same array when nothing moved, so the renderer can compare by identity', () => {
    const indoors = [animal()];
    expect(advanceAnimals(indoors, [coop], [], [], 'Drizzle', noon, 10)).toBe(indoors);
    expect(advanceAnimals([], [coop], [], [], 'Sunny', noon, 10)).toEqual([]);
  });

  it('never wanders further than its own paddock', () => {
    const home = housePoint(coop);
    let herd = [animal()];
    const time = { ...noon };
    for (let step = 0; step < 200; step += 1) {
      const minutes = 10;
      herd = advanceAnimals(
        herd,
        [coop],
        [],
        [],
        'Sunny',
        createTimeState(4, time.totalMinutes + step * minutes),
        minutes,
      );
      const at = herd[0].position;
      if (!at) continue;
      // A wandering animal that drifted would end up in the village. The
      // target is always drawn round its own door, so the distance is bounded
      // by the radius plus the tile it started on.
      expect(Math.hypot(at.x - home.x, at.y - home.y)).toBeLessThan(6 * 32);
    }
  });

  it('is found by the tile it is standing on, and only when it is outside', () => {
    const walked = advanceAnimals([animal()], [coop], [], [], 'Sunny', noon, 10);
    const at = walked[0].position!;
    const tile = { x: Math.floor(at.x / 32), y: Math.floor(at.y / 32) };

    expect(animalAtTile(walked, tile.x, tile.y)?.id).toBe(walked[0].id);
    expect(animalAtTile([animal()], tile.x, tile.y)).toBeNull();
  });
});

describe('house capacity', () => {
  it('matches the footprint each building has, so a bigger house holds more', () => {
    // Not a rule the code enforces, but a promise the panel makes: a barn is
    // the larger building and its animals are the larger animals.
    expect(BUILDING_DEFS.barn.width).toBeGreaterThan(BUILDING_DEFS.coop.width);
    expect(capacityOf('coop')).toBeGreaterThan(capacityOf('barn'));
  });
});

describe('reaching an animal', () => {
  const coop = building('coop', 'b1', { doorOpen: true });

  it('finds the nearest one standing beside you, and nothing indoors', () => {
    const near: Animal = { ...animal('chicken', { id: 'a1' }), position: { x: 100, y: 100 } };
    const far: Animal = { ...animal('cow', { id: 'a2' }), position: { x: 100, y: 140 } };
    const inside = animal('duck', { id: 'a3' });

    expect(nearestAnimal([far, near, inside], { x: 104, y: 104 })?.id).toBe('a1');
    // Inside its house is not "beside you": it is reached through the house.
    expect(nearestAnimal([inside], { x: 104, y: 104 })).toBeNull();
    expect(nearestAnimal([near], { x: 900, y: 900 })).toBeNull();
  });

  it('reaches an animal that has wandered off the tile you are facing', () => {
    // The reason this is proximity rather than a tile: an animal ambles, and
    // the tile it happens to be on this second is not something anybody can
    // aim at. The prompt bar and the reducer both ask this one function.
    const walked = advanceAnimals([animal()], [coop], [], [], 'Sunny', createTimeState(4, 12 * 60), 10);
    const at = walked[0].position!;
    expect(nearestAnimal(walked, { x: at.x + 20, y: at.y + 20 })?.id).toBe(walked[0].id);
  });
});
