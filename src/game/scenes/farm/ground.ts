/**
 * The ground, as it is drawn: the beds, what grows in them, what stands on
 * them and what has been put down on them.
 *
 * Plots, resource nodes and placeables are three arrays in the state and one
 * surface on the screen. They share the wet-ground rule (a sprinkler's reach
 * is drawn on the beds), the depth rule (whatever is walked behind sorts with
 * the avatars) and the small moments a swing or a watering can leaves behind.
 */
import Phaser from 'phaser';
import { fringeTexture } from '../../assets/createPixelArtTextures';
import { tint } from '../../assets/palette.generated';
import type { FarmState } from '../../state/types';
import { isWithering } from '../../systems/farming';
import {
  isMachine,
  isSprinkler,
  machineIsReady,
  placeableDef,
  placeablesOn,
  sprinkledPlotKeys,
  sprinklerTiles,
  type Placeable,
} from '../../systems/placeables';
import { nodesOn, type NodeKind, type ResourceNode } from '../../systems/resources';
import {
  START_AREA,
  TILE_SIZE,
  areaMap,
  edgeMask,
  plotKey,
  type AreaId,
  type TileKind,
} from '../../world/areas';
import {
  AVATAR_DEPTH_BASE,
  DEPTH,
  GROUND_ITEM_DEPTH,
  WILT_TINT,
  type SceneContext,
} from './shared';

/** Which drawing a node gets. A tree's is the one for the stage it has reached. */
function nodeTexture(node: ResourceNode): string {
  if (node.kind === 'tree') return `node-tree-${node.stage ?? 0}`;
  if (node.kind === 'forage') return `node-forage-${node.item}`;
  if (node.kind === 'ore') return `node-ore-${node.item}`;
  return `node-${node.kind}`;
}

/**
 * Where a node's drawing is centred.
 *
 * The art is taller than its tile and stands *in* it rather than filling it:
 * the floor line inside every node texture is at `NODE_FLOOR`, and that line
 * has to land on the bottom edge of the tile the node occupies. Anything above
 * it — a canopy, the top of a boulder — then rises out of the tile, which is
 * what you walk behind.
 */
const NODE_ART = { height: 80, floor: 74 };

function nodeCentreY(node: ResourceNode): number {
  return (node.y + 1) * TILE_SIZE - (NODE_ART.floor - NODE_ART.height / 2);
}

/**
 * How many drawings each sort of ground has. Matches `generate-plot-art.mjs`.
 *
 * The field is most of the screen for most of the game, and one drawing of a
 * tile repeated forty times is the wallpaper effect — the eye picks up the
 * period long before it can say why the picture looks cheap. Three is enough
 * to break it, and cheap enough to be three small files.
 */
const PLOT_VARIANTS = 3;

/**
 * Which drawing of a ground tile this position gets.
 *
 * A hash of the tile rather than a draw, so a plot keeps the same face for the
 * life of the save: a field that reshuffled itself every time it was redrawn
 * would shimmer every morning. The variants are interchangeable by
 * construction — the furrows line up across all three — so nothing but the
 * grain depends on which one lands where.
 */
function plotVariant(base: string, tileX: number, tileY: number): string {
  const pick = tileHash(tileX, tileY) % PLOT_VARIANTS;
  return pick === 0 ? base : `${base}-${pick + 1}`;
}

function tileHash(tileX: number, tileY: number): number {
  let h = (tileX * 374761393 + tileY * 668265263) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * The lawn's own twelve drawings, as `generate-maps.mjs` lays them.
 *
 * An unworked bed is drawn as this lawn rather than as `plot-wild`. The wild
 * tile was a different grass — striped, speckled yellow — so the whole field
 * read as a rectangle of noise cut into the meadow before anyone had touched
 * it. A field is where the hoe has been, and nowhere else.
 */
const LAWN_TEXTURES = [
  'tile-grass',
  'tile-grass-1x',
  'tile-grass-1y',
  'tile-grass-1xy',
  'tile-grass-2',
  'tile-grass-2x',
  'tile-grass-2y',
  'tile-grass-2xy',
  'tile-grass-3',
  'tile-grass-3x',
  'tile-grass-3y',
  'tile-grass-3xy',
];

function lawnVariant(tileX: number, tileY: number): string {
  // Shifted so the pick is not the plot variant's in disguise.
  return LAWN_TEXTURES[(tileHash(tileX, tileY) >>> 3) % LAWN_TEXTURES.length];
}

/**
 * How many tiles the dawn spray draws before it gives up.
 *
 * A farm late in a save can carry fifty sprinklers, and several hundred tweens
 * in the single frame the day turns is a stutter on the one frame nobody wants
 * one. The first few dozen read as the field being watered; the rest would
 * only be arithmetic.
 */
const MAX_SPRAY_TILES = 60;

/**
 * One thing standing on the ground.
 *
 * `texture` is kept beside the sprite so a tree that put on a stage overnight
 * can be spotted without asking Phaser what it is currently drawing, which is
 * the only property of a node that ever changes its picture.
 */
interface NodeSprite {
  sprite: Phaser.GameObjects.Image;
  texture: string;
}

/**
 * One crafted thing standing on the ground, and the bubble over it.
 *
 * `ready` is kept beside the sprite for the same reason `texture` is above:
 * it is the one property that changes the picture, and comparing a boolean is
 * cheaper than asking Phaser what it is currently drawing.
 */
interface PlaceableSprite {
  sprite: Phaser.GameObjects.Image;
  bubble: Phaser.GameObjects.Image | null;
  ready: boolean;
}

/** What a chip flying off a struck node is coloured, by what it came off. */
const CHIP_TINTS: Record<NodeKind, number> = {
  tree: tint('soil.4'),
  stump: tint('soil.3'),
  rock: tint('light.6'),
  boulder: tint('light.6'),
  weed: tint('leaf.2'),
  grass: tint('light.0'),
  forage: tint('light.7'),
  ore: tint('light.6'),
};

/** The beds, the nodes and the placeables on the built area. */
export class GroundView {
  /** One sprite per bed on the built area, keyed by plot key. Filled as the tiles are laid. */
  readonly plotSprites = new Map<string, Phaser.GameObjects.Image>();
  /** The grass lip on a dug bed that borders lawn, keyed by plot key. */
  private soilFringes = new Map<string, Phaser.GameObjects.Image>();
  private cropSprites = new Map<string, Phaser.GameObjects.Image>();
  private sparkles = new Map<string, Phaser.GameObjects.Image>();
  /** One sprite per node on the built area, keyed by node id. */
  private nodeSprites = new Map<string, NodeSprite>();
  /** What `nodeSprites` was last drawn from, so it is only diffed on change. */
  private drawnNodes: FarmState['nodes'] | null = null;
  /**
   * One record per crafted thing standing on the built area.
   *
   * The bubble is the second half of spec 11's "the finished state must be
   * visible from across the farm": a keg is thirty-two pixels and a keg with
   * wine in it is the same thirty-two pixels, so what actually reads at
   * distance is the thing floating above it.
   */
  private placeableSprites = new Map<string, PlaceableSprite>();
  /** What `placeableSprites` was last drawn from, so it is only diffed on change. */
  private drawnPlaceables: FarmState['placeables'] | null = null;
  /**
   * Which plots the sprinklers keep wet, cached on the array that decided it.
   *
   * `refreshPlot` asks this on every plot it redraws, and a field redraw is
   * every plot on the map — so recomputing the set each time would walk every
   * sprinkler forty times a morning for an answer that only changes when
   * somebody puts one down.
   */
  private sprinkled: ReadonlySet<string> = new Set();
  private sprinkledFrom: FarmState['placeables'] | null = null;

  private readonly context: Pick<SceneContext, 'scene' | 'farm' | 'builtArea' | 'areaLayer'>;
  private readonly scene: Phaser.Scene;

  constructor(context: Pick<SceneContext, 'scene' | 'farm' | 'builtArea' | 'areaLayer'>) {
    this.context = context;
    this.scene = context.scene;
  }

  /** Forgets every sprite on the ground, which went with the layer it was drawn in. */
  forgetArea() {
    this.plotSprites.clear();
    this.soilFringes.clear();
    this.cropSprites.clear();
    this.sparkles.clear();
    this.nodeSprites.clear();
    // The sprites went with the layer, so the next `syncNodes` has to draw them
    // again even though the array itself has not changed.
    this.drawnNodes = null;
    this.placeableSprites.clear();
    this.drawnPlaceables = null;
  }

  /**
   * The grass lip along a dug bed's sides, where it meets lawn.
   *
   * The map's own fringes (`AreaView.renderEdges`) are read off the map, and
   * to the map every bed is `plot` whether it has been dug or not. So a strip
   * of soil in an unworked field used to be a hard brown rectangle; this draws
   * the lawn spilling over it the same way it spills over a path.
   */
  private refreshSoilFringe(area: AreaId, x: number, y: number) {
    const key = plotKey(area, x, y);
    this.soilFringes.get(key)?.destroy();
    this.soilFringes.delete(key);

    const map = areaMap(area);
    const { plots } = this.context.farm;
    // Soil, lawn, or neither — a path or water beside a bed has its own edge.
    const lookAt = (tx: number, ty: number): TileKind | null => {
      if (tx < 0 || ty < 0 || tx >= map.width || ty >= map.height) return null;
      const kind = map.tiles[ty * map.width + tx]?.kind;
      if (kind === 'grass') return 'grass';
      if (kind !== 'plot') return null;
      const plot = plots[plotKey(area, tx, ty)];
      return plot && (plot.stage !== 'wild' || plot.wateredToday) ? 'plot' : 'grass';
    };
    if (lookAt(x, y) !== 'plot') return;

    const mask = edgeMask(lookAt, x, y);
    if (mask === 0) return;
    const fringe = this.scene.add
      .image(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, fringeTexture('grass', 'soil', mask))
      // The same depth as the map's fringes: over the ground, under the crop.
      .setDepth(0.5);
    this.context.areaLayer?.add(fringe);
    this.soilFringes.set(key, fringe);
  }

  /** Redraws every plot on this map, which the wilt tint needs once a day. */
  refreshAllPlots() {
    for (const key of this.plotSprites.keys()) this.refreshPlot(key);
  }

  /**
   * Redraws one plot. Keys carry their area, so a plot that changed on another
   * map simply has no sprite here and is skipped.
   */
  refreshPlot(key: string) {
    const plot = this.context.farm.plots[key];
    const base = this.plotSprites.get(key);
    if (!plot || !base) return;

    const { x, y } = plot;
    // Wet if somebody watered it, or if a sprinkler has it covered. The second
    // half is what makes a sprinkler visible at all: the water it lays down is
    // spent by the growth step in the same roll-over, so `wateredToday` is
    // false again before anybody wakes up. See `sprinkledPlotKeys`.
    const damp = plot.wateredToday || (plot.stage !== 'wild' && this.sprinkledKeys().has(key));
    const lawn = lawnVariant(x, y);
    base.setTexture(
      !damp && plot.stage === 'wild'
        ? this.scene.textures.exists(lawn) ? lawn : 'tile-grass'
        : plotVariant(damp ? 'plot-watered' : 'plot-tilled', x, y),
    );

    // Digging or re-wilding a bed changes the edge of the beds beside it too.
    const area = this.context.builtArea ?? START_AREA;
    for (const [dx, dy] of [[0, 0], [0, -1], [1, 0], [0, 1], [-1, 0]]) {
      this.refreshSoilFringe(area, x + dx, y + dy);
    }

    this.cropSprites.get(key)?.destroy();
    this.cropSprites.delete(key);
    this.sparkles.get(key)?.destroy();
    this.sparkles.delete(key);

    if (!plot.crop) return;
    // A shoot is a shoot, so only the ripe plant gets art of its own.
    const cropTexture =
      plot.stage === 'mature'
        ? `crop-${plot.crop}`
        : plot.stage === 'sprout'
          ? 'crop-sprout'
          : 'crop-seeded';
    const crop = this.scene.add.image(x * TILE_SIZE + 16, y * TILE_SIZE + 16, cropTexture).setDepth(y + 2);
    this.context.areaLayer?.add(crop);
    this.cropSprites.set(key, crop);

    // The warning spec 04 gives that Stardew does not: in the last three days
    // of a season, anything the turn will kill goes grey and droops. Losing a
    // field to a rule you had not noticed reads as unfair rather than hard.
    const doomed = isWithering(plot.crop, this.context.farm.time.day);
    // Droop and sway are both a pixel of movement rather than a rotation, for
    // the reason set out where the trees are built: Phaser 4 tears a rotated
    // sprite about half the frames it draws.
    if (doomed) {
      crop.setTint(WILT_TINT);
      crop.setY(crop.y + 1);
    }

    if (!doomed && (plot.stage === 'sprout' || plot.stage === 'mature')) {
      this.scene.tweens.add({
        targets: crop,
        x: crop.x + 1,
        yoyo: true,
        repeat: -1,
        duration: 1600 + (x + y) * 40,
        ease: 'Sine.inOut',
      });
    }
    // No sparkle on a plant that is about to die, however ripe it is: the
    // "come and pick me" cue and the "you are about to lose this" cue would
    // be arguing on the same tile.
    if (!doomed && plot.stage === 'mature') {
      const sparkle = this.scene.add.image(x * TILE_SIZE + 22, y * TILE_SIZE + 6, 'sparkle').setDepth(y + 3).setScale(0.8);
      this.context.areaLayer?.add(sparkle);
      this.sparkles.set(key, sparkle);
      this.scene.tweens.add({ targets: sparkle, alpha: 0.2, scale: 1.2, yoyo: true, repeat: -1, duration: 700, ease: 'Sine.inOut' });
      crop.setScale(0.6);
      this.scene.tweens.add({ targets: crop, scale: 1, duration: 260, ease: 'Back.easeOut' });
    }
  }

  /**
   * Draws what is standing on this map, and keeps it drawn.
   *
   * Diffed by id rather than torn down and rebuilt, unlike the buildings: a
   * farm carries a couple of hundred nodes and every single swing changes the
   * array, so a rebuild would drop and recreate two hundred sprites every time
   * somebody clipped a weed. The array's identity is still the gate — the
   * reducer is immutable, so an unchanged array means nothing to do at all.
   *
   * Sorted into the avatars' own band, by the row the node's feet stand on, so
   * a player north of a tree is drawn behind its trunk and a player south of
   * it walks in front of the canopy. The same rule the buildings follow, for
   * the same reason: a tree that is two tiles of drawing and one tile of
   * collision only reads right if the sorting agrees with the collision.
   */
  syncNodes() {
    const { nodes } = this.context.farm;
    if (nodes === this.drawnNodes) return;
    this.drawnNodes = nodes;

    const here = nodesOn(nodes, this.context.builtArea ?? START_AREA);
    const present = new Set<string>();

    for (const node of here) {
      present.add(node.id);
      const texture = nodeTexture(node);
      const drawn = this.nodeSprites.get(node.id);
      if (drawn) {
        // The only thing that ever changes a node's picture is a tree putting
        // on a stage overnight.
        if (drawn.texture !== texture) {
          drawn.sprite.setTexture(texture);
          drawn.texture = texture;
        }
        continue;
      }
      this.nodeSprites.set(node.id, { sprite: this.createNodeSprite(node, texture), texture });
    }

    for (const [id, drawn] of this.nodeSprites) {
      // Anything felled has already had its burst played from the event; this
      // is only the bookkeeping, and the sprite may well be gone already.
      if (present.has(id)) continue;
      drawn.sprite.destroy();
      this.nodeSprites.delete(id);
    }
  }

  /**
   * Chests, machines, sprinklers, fences and paths.
   *
   * Diffed against the array's identity exactly as the nodes and the buildings
   * are: the reducer is immutable, so a farm where nobody has put anything
   * down this frame hands back the same array and this returns immediately.
   */
  syncPlaceables() {
    const { placeables } = this.context.farm;
    const day = this.context.farm.time.day;
    if (placeables === this.drawnPlaceables) return;
    this.drawnPlaceables = placeables;

    const area = this.context.builtArea ?? START_AREA;
    const present = new Set<string>();
    const coverageBefore = this.sprinkledKeys();

    for (const placeable of placeablesOn(placeables, area)) {
      present.add(placeable.id);
      const ready = isMachine(placeable) && machineIsReady(placeable, day);
      const drawn = this.placeableSprites.get(placeable.id);

      if (drawn) {
        if (drawn.ready !== ready) {
          drawn.bubble?.destroy();
          drawn.bubble = ready ? this.createBubble(placeable) : null;
          drawn.ready = ready;
        }
        continue;
      }

      const sprite = this.scene.add
        .image(
          placeable.x * TILE_SIZE + TILE_SIZE / 2,
          placeable.y * TILE_SIZE + TILE_SIZE / 2,
          `placeable-${placeable.kind}`,
        )
        // Paths and sprinklers are walked over, so they are drawn under
        // everything that walks; a chest is walked behind, like a node.
        // A path is walked *on*, so it sits just above the ground and below
        // everything standing on it; a chest is walked *behind*, so it joins
        // the avatars' band and sorts against them by tile row.
        .setDepth(
          placeableDef(placeable.kind).solid ? placeable.y + AVATAR_DEPTH_BASE : GROUND_ITEM_DEPTH,
        );
      this.context.areaLayer?.add(sprite);
      this.placeableSprites.set(placeable.id, {
        sprite,
        bubble: ready ? this.createBubble(placeable) : null,
        ready,
      });
    }

    for (const [id, drawn] of this.placeableSprites) {
      if (present.has(id)) continue;
      drawn.sprite.destroy();
      drawn.bubble?.destroy();
      this.placeableSprites.delete(id);
    }

    // A sprinkler that has just been put down — or taken up — changes which
    // beds are drawn wet, and those beds did not themselves change.
    if (this.coverageDiffers(coverageBefore)) this.refreshAllPlots();
  }

  /** Whether sprinkler coverage differs from what the beds were drawn with. */
  private coverageDiffers(before: ReadonlySet<string>): boolean {
    const after = this.sprinkledKeys();
    if (before.size !== after.size) return true;
    for (const key of after) if (!before.has(key)) return true;
    return false;
  }

  /** The little bob over a machine with something waiting in it. */
  private createBubble(placeable: Placeable): Phaser.GameObjects.Image {
    const bubble = this.scene.add
      .image(placeable.x * TILE_SIZE + TILE_SIZE / 2, placeable.y * TILE_SIZE - 6, 'machine-bubble')
      .setDepth(placeable.y + AVATAR_DEPTH_BASE + 1);
    this.context.areaLayer?.add(bubble);
    // A slow bob rather than a flash: it has to catch the eye from the far
    // side of a field without being the brightest thing on the screen.
    this.scene.tweens.add({
      targets: bubble,
      y: bubble.y - 3,
      yoyo: true,
      repeat: -1,
      duration: 900,
      ease: 'Sine.inOut',
    });
    return bubble;
  }

  private createNodeSprite(node: ResourceNode, texture: string): Phaser.GameObjects.Image {
    const sprite = this.scene.add
      .image(node.x * TILE_SIZE + TILE_SIZE / 2, nodeCentreY(node), texture)
      .setDepth(node.y + AVATAR_DEPTH_BASE);
    this.context.areaLayer?.add(sprite);
    return sprite;
  }

  /**
   * A swing that landed and did not finish the job.
   *
   * One pixel of lean and back, which is what the trees on the map already do
   * for wind and for the reason set out where those are built: Phaser 4 tears
   * a rotated sprite about half the frames it draws, so nothing in this
   * renderer rotates.
   */
  shakeNode(id: string, kind: NodeKind) {
    const drawn = this.nodeSprites.get(id);
    if (!drawn) return;
    const rest = drawn.sprite.x;
    this.scene.tweens.killTweensOf(drawn.sprite);
    drawn.sprite.setX(rest);
    this.scene.tweens.add({
      targets: drawn.sprite,
      x: rest + 2,
      yoyo: true,
      repeat: 1,
      duration: 55,
      ease: 'Sine.inOut',
      onComplete: () => drawn.sprite.setX(rest),
    });
    this.chips(drawn.sprite.x, drawn.sprite.y + drawn.sprite.displayHeight / 4, kind, 3);
  }

  /** It came down: a scatter of chips, and the sprite dropping out of sight. */
  burstNode(id: string, kind: NodeKind) {
    const drawn = this.nodeSprites.get(id);
    if (!drawn) return;
    this.nodeSprites.delete(id);
    this.chips(drawn.sprite.x, drawn.sprite.y + drawn.sprite.displayHeight / 4, kind, 7);
    this.scene.tweens.killTweensOf(drawn.sprite);
    this.scene.tweens.add({
      targets: drawn.sprite,
      y: drawn.sprite.y + 6,
      alpha: 0,
      scaleY: 0.4,
      duration: 220,
      ease: 'Quad.easeIn',
      onComplete: () => drawn.sprite.destroy(),
    });
  }

  /** The sprinkler coverage for this map, recomputed only when it can change. */
  private sprinkledKeys(): ReadonlySet<string> {
    const { placeables } = this.context.farm;
    if (this.sprinkledFrom !== placeables) {
      this.sprinkledFrom = placeables;
      this.sprinkled = sprinkledPlotKeys(placeables, this.context.builtArea ?? START_AREA);
    }
    return this.sprinkled;
  }

  /**
   * Water landing on a tile.
   *
   * The beads arc outward and *settle* rather than flying off the way the
   * chips a struck rock throws do: they end lower than they started and fade
   * on the ground, because water falls. The same helper serves a can and a
   * sprinkler, so the two read as the same substance.
   */
  splash(tileX: number, tileY: number, count = 5) {
    const x = tileX * TILE_SIZE + TILE_SIZE / 2;
    const y = tileY * TILE_SIZE + TILE_SIZE / 2;
    for (let i = 0; i < count; i += 1) {
      const bead = this.scene.add
        .image(x, y - 10, 'water-bead')
        .setDepth(tileY + AVATAR_DEPTH_BASE - 2)
        .setAlpha(0.95);
      this.context.areaLayer?.add(bead);
      this.scene.tweens.add({
        targets: bead,
        x: x + Phaser.Math.Between(-13, 13),
        y: y + Phaser.Math.Between(2, 9),
        alpha: 0,
        scaleX: 0.6,
        scaleY: 0.4,
        duration: 320 + i * 25,
        ease: 'Quad.easeIn',
        onComplete: () => bead.destroy(),
      });
    }
  }

  /**
   * Every sprinkler on this map, going off at once.
   *
   * Played on the morning they run, which is the only moment they actually do
   * anything. Capped, because a farm late in a save can carry a great many of
   * them and several hundred tweens in the frame the day turns is a stutter on
   * the one frame nobody wants one.
   */
  spraySprinklers() {
    const area = this.context.builtArea ?? START_AREA;
    let drawn = 0;
    for (const placeable of this.context.farm.placeables) {
      if (placeable.area !== area || !isSprinkler(placeable)) continue;
      for (const tile of sprinklerTiles(placeable)) {
        if (drawn >= MAX_SPRAY_TILES) return;
        if (this.context.farm.plots[plotKey(tile.area, tile.x, tile.y)]?.stage === 'wild') continue;
        this.splash(tile.x, tile.y, 3);
        drawn += 1;
      }
    }
  }

  /** Splinters, or stone, or a spray of cut grass. One drawing, tinted. */
  private chips(x: number, y: number, kind: NodeKind, count: number) {
    for (let i = 0; i < count; i += 1) {
      const chip = this.scene.add
        .image(x, y, 'node-chip')
        .setTint(CHIP_TINTS[kind])
        .setDepth(DEPTH.weather - 5);
      this.context.areaLayer?.add(chip);
      this.scene.tweens.add({
        targets: chip,
        x: x + Phaser.Math.Between(-22, 22),
        y: y + Phaser.Math.Between(-18, 8),
        alpha: 0,
        duration: 340 + i * 20,
        ease: 'Quad.easeOut',
        onComplete: () => chip.destroy(),
      });
    }
  }
}
