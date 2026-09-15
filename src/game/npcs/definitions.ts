import { ASH } from './villagers/ash';
import { BRAM } from './villagers/bram';
import { JUNIPER } from './villagers/juniper';
import { MAEVE } from './villagers/maeve';
import { ROWAN } from './villagers/rowan';
import { TOBIAS } from './villagers/tobias';
import type { NpcDef, NpcId } from './types';

export * from './types';

/**
 * Everybody, in the order they appear in lists.
 *
 * NPCs are data: the engine reads this and nothing in the reducer knows any of
 * their names. Adding a villager is a file in `villagers/` and a line here —
 * the schedule, the gift table and the dialogue all come with them, and no
 * switch statement anywhere has to grow a case.
 */
export const NPCS: Record<NpcId, NpcDef> = {
  rowan: ROWAN,
  maeve: MAEVE,
  tobias: TOBIAS,
  juniper: JUNIPER,
  ash: ASH,
  bram: BRAM,
};

export const NPC_IDS = Object.keys(NPCS) as NpcId[];

export function npcDef(id: NpcId): NpcDef {
  return NPCS[id];
}

export function isNpcId(value: unknown): value is NpcId {
  return typeof value === 'string' && Object.hasOwn(NPCS, value);
}
