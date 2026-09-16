/**
 * The small verbs every rule in this folder is written in.
 *
 * Nothing here knows about any one system: a result that changed nothing, a
 * line said to one player, a player written back, who is online, and what is
 * standing in the way on a map. They live at the bottom of the rules so that
 * every other module can lean on them while this one leans on none of those.
 */
import { buildingsOn, solidRects } from '../../systems/buildings';
import { solidPlaceableRects } from '../../systems/placeables';
import { solidNodeRects } from '../../systems/resources';
import type { AreaId, Blockers, Direction } from '../../world/areas';
import type { ApplyResult, GameEvent } from '../intents';
import type { FarmState, PlayerId, PlayerState } from '../types';

/**
 * Everything standing in the way of a player on this map.
 *
 * Two sources now, which is exactly why `Blockers` is an object: the third one
 * spec 13 brings is a field here rather than a fourth argument at every call
 * site that has to be threaded through.
 */
export function blockersFor(state: FarmState, area: AreaId): Blockers {
  return {
    buildings: solidRects(buildingsOn(state.buildings, area)),
    nodes: solidNodeRects(state.nodes, area),
    placeables: solidPlaceableRects(state.placeables, area),
  };
}

export function facingFor(dx: number, dy: number, fallback: Direction): Direction {
  if (dx === 0 && dy === 0) return fallback;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
  return dy > 0 ? 'down' : 'up';
}

export function unchanged(state: FarmState): ApplyResult {
  return { state, events: [] };
}

export function say(playerId: PlayerId, text: string): GameEvent {
  return { kind: 'message', playerId, text };
}

/** Everyone with a place here who is actually connected right now. */
export function onlineMembers(state: FarmState): PlayerState[] {
  return Object.values(state.players).filter((player) => player.online);
}

/** Writes one player back, bumping the revision. The shape of half of these. */
export function withPlayer(state: FarmState, player: PlayerState): FarmState {
  return {
    ...state,
    revision: state.revision + 1,
    players: { ...state.players, [player.id]: player },
  };
}
