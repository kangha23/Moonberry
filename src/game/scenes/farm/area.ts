/**
 * The area itself, as it is drawn: the tiles, the soft edges where one kind of
 * ground meets another, the props the map was made with, the tufts scattered
 * over the grass, and the buildings the farm has put up on it.
 *
 * Everything here is laid down once per area build except the buildings,
 * which are state and can go up while somebody is standing there. The scene
 * decides when an area is built; this decides what building one draws.
 */
import type Phaser from 'phaser';
import { FRINGE_BOUNDARIES, fringeTexture } from '../../assets/createPixelArtTextures';
import { tint } from '../../assets/palette.generated';
import type { FarmState } from '../../state/types';
import { BUILDING_AREA, buildingBounds, buildingDef, isComplete } from '../../systems/buildings';
import {
  TILE_SIZE,
  areaMap,
  edgeMask,
  pairKindAt,
  plotKey,
  type AreaId,
  type AreaMap,
} from '../../world/areas';
import type { GroundView } from './ground';
import { AVATAR_DEPTH_BASE, propDepth, type SceneContext } from './shared';

/** The map of the built area, drawn. */
export class AreaView {
  /** One sprite per building on the built area, keyed by building id. */
  private buildingSprites = new Map<string, Phaser.GameObjects.Image>();
  /** What `buildingSprites` was last drawn from, so it is only rebuilt on change. */
  private drawnBuildings: FarmState['buildings'] | null = null;
  waterSprites: Phaser.GameObjects.Image[] = [];
  houseGlow: Phaser.GameObjects.Image | null = null;
  /**
   * The fire in the farmhouse hearth: the only light in a room with no sky.
   * The same glow that lights the house's windows from outside, lit all day
   * rather than only after dark, and flickering rather than breathing.
   */
  hearthGlow: Phaser.GameObjects.Image | null = null;
  hearthFire: Phaser.GameObjects.Image | null = null;
  chimney: { x: number; y: number } | null = null;

  private readonly context: Pick<SceneContext, 'scene' | 'farm' | 'builtArea' | 'areaLayer'>;
  private readonly scene: Phaser.Scene;
  /** Where a plot tile's sprite is handed over, so the beds can be redrawn later. */
  private readonly ground: Pick<GroundView, 'plotSprites'>;

  constructor(
    context: Pick<SceneContext, 'scene' | 'farm' | 'builtArea' | 'areaLayer'>,
    ground: Pick<GroundView, 'plotSprites'>,
  ) {
    this.context = context;
    this.scene = context.scene;
    this.ground = ground;
  }

  /** Forgets everything drawn for the last area, which went with its layer. */
  forgetArea() {
    this.buildingSprites.clear();
    // The sprites went with the layer, so the next `syncBuildings` has to draw
    // them again even though the array itself has not changed.
    this.drawnBuildings = null;
    this.waterSprites = [];
    this.houseGlow = null;
    this.hearthGlow = null;
    this.hearthFire = null;
    this.chimney = null;
  }

  /**
   * Keeps the camera inside the area, and a small area in the middle of the
   * screen.
   *
   * Phaser clamps a camera to its bounds by the left and top edges, so a map
   * narrower than the view — the farmhouse is 384px wide against a view twice
   * that — ends up pinned to the top-left corner with the rest of the screen
   * empty. Padding the bounds out to the view's size on both sides leaves the
   * camera exactly one place to be, which is centred.
   *
   * Depends on the zoom, so a resize has to ask again.
   */
  fitCameraBounds() {
    if (!this.context.builtArea) return;
    const map = areaMap(this.context.builtArea);
    const camera = this.scene.cameras.main;
    const padX = Math.max(0, (camera.width / camera.zoom - map.pixelWidth) / 2);
    const padY = Math.max(0, (camera.height / camera.zoom - map.pixelHeight) / 2);
    camera.setBounds(-padX, -padY, map.pixelWidth + padX * 2, map.pixelHeight + padY * 2);
  }

  renderTiles(map: AreaMap, area: AreaId) {
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        const tile = map.tiles[y * map.width + x];
        if (!tile) continue;
        const image = this.scene.add
          .image(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, tile.texture)
          .setDepth(0);
        this.context.areaLayer?.add(image);
        if (tile.kind === 'plot') this.ground.plotSprites.set(plotKey(area, x, y), image);
        if (tile.kind === 'water') this.waterSprites.push(image);
      }
    }
    this.renderEdges(map);
  }

  /**
   * Softens the three boundaries where one kind of ground meets another.
   *
   * A dirt path used to be cut out of the lawn with a hard rectangular edge,
   * which is what made a map read as a grid of squares rather than as a piece
   * of land. Here the higher material spills a few pixels over the lower one —
   * grass over a path, grass over a bank, a path over water — with a dithered,
   * uneven leading edge, and the squares stop being visible.
   *
   * Once per area build, never per frame. `edgeMask` is pure and the mask only
   * changes when the map does, which is never: these are the same forty-five
   * textures laid down in the same places every time this area is entered.
   */
  private renderEdges(map: AreaMap) {
    const kindAt = (x: number, y: number) => {
      if (x < 0 || y < 0 || x >= map.width || y >= map.height) return null;
      return map.tiles[y * map.width + x]?.kind ?? null;
    };

    for (const { over, under } of FRINGE_BOUNDARIES) {
      // Read the map as if only these two kinds existed, so a tile touching
      // both grass and water gets one mask per boundary rather than one
      // muddled mask describing neither.
      const paired = pairKindAt(kindAt, under, over);

      for (let y = 0; y < map.height; y += 1) {
        for (let x = 0; x < map.width; x += 1) {
          // The fringe is drawn on the lower material, looking up.
          if (kindAt(x, y) !== under) continue;
          const mask = edgeMask(paired, x, y);
          if (mask === 0) continue;

          const texture = fringeTexture(over, under, mask);
          if (!this.scene.textures.exists(texture)) continue;
          const fringe = this.scene.add
            .image(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, texture)
            // Above the ground and below everything that stands on it, so a
            // tilled plot drawn later still covers its own tile.
            .setDepth(0.5);
          this.context.areaLayer?.add(fringe);
        }
      }
    }
  }

  renderProps(map: AreaMap) {
    for (const prop of map.props) {
      const centreX = prop.x + prop.width / 2;
      const centreY = prop.y + prop.height / 2;

      const image = this.scene.add.image(centreX, centreY, prop.texture);
      // Props are sized by their Tiled footprint, so resizing one in the editor
      // resizes it in game without touching this file — but the footprint sets
      // the width only, and the height follows the drawing's own proportions.
      //
      // Stretching to the full footprint is what squashed the trees: `tree.png`
      // is 96x136 and its object is two tiles square, so a tall tree was being
      // pressed into a 64x64 box and came out a shrub with a wide hat. Every
      // other prop is already drawn at exactly its footprint, so this changes
      // nothing for them — and it means a tree's collision can stay the tile or
      // two of trunk you actually walk into while the canopy rises above it.
      //
      // Art taller than its box grows upwards out of the ground rather than
      // spilling equally past both ends, so the drawn rectangle is moved up by
      // half its overhang instead of being re-anchored.
      //
      // Moved rather than re-anchored deliberately. `setOrigin(0.5, 1)` says
      // the same thing far more plainly, and it cannot be used: Phaser 4 draws
      // a sprite wrong when it is rotated *and* its origin is off centre, and
      // the trees are rotated by the wind sway. It tears the quad into wedges
      // with the background showing through. Measured on this tree at 1.4
      // degrees: origin 0.5/1 tears at every size tried, origin 0.5/0.5 is
      // clean, and at angle 0 both are clean. So the origin stays centred and
      // the position does the work.
      const source = this.scene.textures.get(prop.texture)?.getSourceImage();
      const naturalWidth = source && 'width' in source ? source.width : prop.width;
      const naturalHeight = source && 'height' in source ? source.height : prop.height;
      const drawnHeight = naturalWidth > 0 ? (prop.width * naturalHeight) / naturalWidth : prop.height;
      image.setDisplaySize(prop.width, drawnHeight);
      image.setPosition(centreX, prop.y + prop.height - drawnHeight / 2);
      // Everything drawn with the prop is placed relative to this depth, except
      // the shadows: a shadow is on the ground, and stays at the map's depth
      // under the avatar band whether or not its prop has joined it. What sits
      // on top of the prop — a window's glow, a fire — goes up by less than a
      // whole row, or in the avatar band it would cover whoever stands in front.
      const depth = propDepth(prop, drawnHeight, TILE_SIZE);
      image.setDepth(depth);
      this.context.areaLayer?.add(image);

      if (prop.texture === 'farmhouse') {
        const shadow = this.scene.add
          .image(centreX, prop.y + prop.height, 'shadow-soft')
          .setDepth(prop.depth - 1)
          .setScale(3.2, 2.4)
          .setAlpha(0.85);
        // The windows and the chimney belong to the drawing, not to the box
        // the map drew around it: a house is as tall as its art, and the art
        // stands on the footprint's bottom edge rather than filling it. Read
        // off `image` and the smoke leaves the chimney at whatever height the
        // house happens to be drawn at, instead of a measurement from the top
        // of the footprint that only held for one picture.
        const top = image.y - image.displayHeight / 2;
        const glow = this.scene.add.image(centreX, image.y, 'glow').setDepth(depth + 0.5).setScale(2.6).setAlpha(0);
        this.context.areaLayer?.addMultiple([shadow, glow]);
        this.houseGlow = glow;
        this.chimney = { x: centreX + prop.width / 3, y: top + 2 };
      }

      if (prop.texture === 'furniture-fireplace') {
        // In the mouth of the hearth, standing on the hearthstone, which is
        // about seven tenths of the way down the drawing: the mantel and the
        // carving above the arch are the top third of it.
        const top = image.y - image.displayHeight / 2;
        const hearth = top + image.displayHeight * 0.7;
        const fire = this.scene.add
          .image(centreX, hearth - 8, 'hearth-fire-0')
          .setDepth(depth + 0.25);
        // Tinted towards the fire's own orange. The glow texture is the pale
        // one the house windows use, and on its own it read as a haze rather
        // than as firelight.
        const glow = this.scene.add
          .image(centreX, hearth - 10, 'glow')
          .setDepth(depth + 0.5)
          .setScale(1.6)
          .setTint(tint('light.4'))
          .setAlpha(0.6);
        this.context.areaLayer?.addMultiple([fire, glow]);
        this.hearthFire = fire;
        this.hearthGlow = glow;
      }

      if (prop.texture === 'tree') {
        const shadow = this.scene.add
          .image(centreX, prop.y + prop.height, 'shadow-soft')
          .setDepth(prop.depth - 1)
          .setScale(1.5, 1.1)
          .setAlpha(0.8);
        this.context.areaLayer?.add(shadow);
        // A pixel of lean, not a rotation.
        //
        // This used to tween `angle`, and Phaser 4 draws a rotated sprite
        // wrong: measured on this tree at 24 frames a run, a swaying tree came
        // back torn into wedges in 12 of them, and with the sway switched off
        // all 24 frames were identical to the pixel. It is not the size, the
        // origin, `roundPixels` or the camera — every one of those was held
        // and varied — and 4.2.1 does the same. It is the rotation.
        //
        // Sliding one pixel is what a 2D game did about wind before it could
        // rotate anything, it reads as the same breeze at this zoom, and it
        // lands on the pixel grid rather than between it.
        const rest = image.x;
        this.scene.tweens.add({
          targets: image,
          x: rest + ((prop.x / TILE_SIZE) % 2 === 0 ? 1 : -1),
          yoyo: true,
          repeat: -1,
          duration: 2400 + ((prop.x / TILE_SIZE) % 5) * 400,
          ease: 'Sine.inOut',
        });
      }
    }
  }

  /**
   * Draws what has been built, and keeps it drawn.
   *
   * Buildings are state rather than map, so they cannot go up with the props:
   * one can appear while the player is standing there. Rebuilt only when the
   * array's identity changes, which — because the reducer is immutable — is
   * exactly when something was actually placed or finished.
   */
  syncBuildings() {
    const { buildings } = this.context.farm;
    if (buildings === this.drawnBuildings) return;
    this.drawnBuildings = buildings;

    for (const sprite of this.buildingSprites.values()) sprite.destroy();
    this.buildingSprites.clear();
    if (this.context.builtArea !== BUILDING_AREA) return;

    for (const building of buildings) {
      const def = buildingDef(building.kind);
      const bounds = buildingBounds(building);
      const done = isComplete(building);
      // A finished building is drawn at its own size, centred on its footprint
      // and standing on the footprint's bottom edge, so a silo taller than its
      // three tiles rises out of them rather than being squashed into them.
      // Stretching to the footprint was fine while the drawings were made to
      // measure; the ones from an art pack are not, and pixel art scaled by
      // anything but a whole number is exactly what `pixelArt` is on to avoid.
      //
      // The scaffold is still stretched: it is one drawing for four sizes of
      // site, and a site is as big as the building going up on it.
      const sprite = this.scene.add
        .image(bounds.x + bounds.width / 2, bounds.y + bounds.height, done ? `building-${building.kind}` : 'building-scaffold')
        .setOrigin(0.5, 1)
        // Sorted by the row the building's feet stand on, in the avatars' own
        // band rather than the props' — `+ AVATAR_DEPTH_BASE` is what an
        // avatar adds to its row, and matching it is the whole point: a player
        // north of a barn has the lower row and is drawn behind it, and a
        // player south of it has the higher row and is drawn in front.
        .setDepth(building.y + def.height - 1 + AVATAR_DEPTH_BASE);
      if (!done) sprite.setDisplaySize(bounds.width, bounds.height);
      this.context.areaLayer?.add(sprite);
      this.buildingSprites.set(building.id, sprite);
    }
  }

  /** Grass tufts, scattered deterministically so an area always looks the same. */
  renderScatter(map: AreaMap) {
    let placed = 0;
    const limit = Math.floor((map.width * map.height) / 28);
    for (let y = 0; y < map.height && placed < limit; y += 1) {
      for (let x = 0; x < map.width && placed < limit; x += 1) {
        if (map.tiles[y * map.width + x]?.kind !== 'grass') continue;
        if ((x * 13 + y * 29) % 11 !== 0) continue;
        const tuft = this.scene.add
          .image(x * TILE_SIZE + 16, y * TILE_SIZE + 18, 'grass-tuft')
          .setDepth(y)
          .setAlpha(0.95);
        this.context.areaLayer?.add(tuft);
        placed += 1;
      }
    }
  }
}
