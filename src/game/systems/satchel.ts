export type CropId = 'turnip' | 'strawberry';

/**
 * One player's carried items. Coins deliberately live on the farm instead:
 * the wallet is shared between everyone on a farm, the satchel is not.
 */
export interface Satchel {
  seeds: Record<CropId, number>;
  crops: Record<CropId, number>;
  water: number;
  wood: number;
}

export const STARTING_WATER = 12;

export function createSatchel(): Satchel {
  return {
    seeds: { turnip: 8, strawberry: 2 },
    crops: { turnip: 0, strawberry: 0 },
    water: STARTING_WATER,
    wood: 5,
  };
}

export function cloneSatchel(satchel: Satchel): Satchel {
  return {
    seeds: { ...satchel.seeds },
    crops: { ...satchel.crops },
    water: satchel.water,
    wood: satchel.wood,
  };
}

export function spendSeed(satchel: Satchel, crop: CropId): Satchel | null {
  if (satchel.seeds[crop] <= 0) return null;
  const next = cloneSatchel(satchel);
  next.seeds[crop] -= 1;
  return next;
}

export function spendWater(satchel: Satchel): Satchel | null {
  if (satchel.water <= 0) return null;
  const next = cloneSatchel(satchel);
  next.water -= 1;
  return next;
}

export function refillWater(satchel: Satchel, amount = STARTING_WATER): Satchel {
  return { ...cloneSatchel(satchel), water: amount };
}

export function addCrop(satchel: Satchel, crop: CropId, amount = 1): Satchel {
  const next = cloneSatchel(satchel);
  next.crops[crop] += amount;
  return next;
}

export function countCrops(satchel: Satchel): number {
  return (Object.keys(satchel.crops) as CropId[]).reduce((total, crop) => total + satchel.crops[crop], 0);
}
