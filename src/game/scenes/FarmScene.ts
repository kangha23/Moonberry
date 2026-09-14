import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../constants';
import { createPixelArtTextures } from '../assets/createPixelArtTextures';
import { connectToFarm, type FarmConnection } from '../net/client';
import type { GameEvent } from '../state/intents';
import { promptFor } from '../state/selectors';
import {
  dispatch,
  farmStore,
  initFarm,
  joinAsLocalPlayer,
  onGameEvent,
  sendAction,
  sendMove,
  startAutosave,
} from '../state/store';
import { TOOL_LABELS, TOOL_ORDER, type PlayerId, type PlayerState } from '../state/types';
import { CROP_DEFINITIONS } from '../systems/farming';
import {
  START_AREA,
  TILE_SIZE,
  areaMap,
  plotKey,
  targetTile,
  tileAt,
  type AreaId,
  type AreaMap,
  type Direction,
} from '../world/areas';

type KeyMap = Record<string, Phaser.Input.Keyboard.Key>;

/** LPC walkcycle rows: 0 = up, 1 = left, 2 = down, 3 = right (9 frames each). */
const WALK_ROW: Record<Direction, number> = { up: 0, left: 1, down: 2, right: 3 };

/** Player id used while playing offline. Online, the server's session id wins. */
const OFFLINE_PLAYER_ID = 'local';

/**
 * Depth bands. World objects sort by tile row below `weather`; everything at or
 * above it is screen-space and pinned to the camera.
 */
const DEPTH = {
  weather: 1000,
  overlay: 1100,
  hud: 1200,
};

interface Avatar {
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  lastX: number;
  lastY: number;
}

/**
 * Renders the world and turns input into intents.
 *
 * The scene owns no game state. Everything it draws it reads from the farm
 * store, and every change it makes it requests through the store. Which map is
 * on screen follows the local player's `area`, so walking through a doorway
 * rebuilds the world rather than switching to a different scene.
 */
export default class FarmScene extends Phaser.Scene {
  /** The area currently built. Null until the first build. */
  private builtArea: AreaId | null = null;

  /** Everything belonging to the current area, dropped wholesale on a rebuild. */
  private areaLayer: Phaser.GameObjects.Group | null = null;

  private plotSprites = new Map<string, Phaser.GameObjects.Image>();
  private cropSprites = new Map<string, Phaser.GameObjects.Image>();
  private sparkles = new Map<string, Phaser.GameObjects.Image>();
  private waterSprites: Phaser.GameObjects.Image[] = [];
  private avatars = new Map<PlayerId, Avatar>();
  private questIcon: Phaser.GameObjects.Image | null = null;
  private houseGlow: Phaser.GameObjects.Image | null = null;
  private chimney: { x: number; y: number } | null = null;

  private cursor!: Phaser.GameObjects.Image;
  private keys!: KeyMap;
  private promptText!: Phaser.GameObjects.Text;
  private toolbarText!: Phaser.GameObjects.Text;
  private clockText!: Phaser.GameObjects.Text;
  private weatherText!: Phaser.GameObjects.Text;
  private dayNightOverlay!: Phaser.GameObjects.Rectangle;
  private sunsetOverlay!: Phaser.GameObjects.Rectangle;
  private rainDrops: Phaser.GameObjects.Image[] = [];
  private fireflies: Phaser.GameObjects.Image[] = [];
  private clouds: Phaser.GameObjects.Image[] = [];
  private petals: Phaser.GameObjects.Image[] = [];
  private butterflies: Phaser.GameObjects.Image[] = [];

  private smokeTimer = 0;
  private dustTimer = 0;
  private waterTimer = 0;
  private waterFrame = 0;
  private lastWeather = '';
  private unsubscribeEvents: (() => void) | null = null;
  private stopAutosave: (() => void) | null = null;
  private connection: FarmConnection | null = null;

  constructor() {
    super('farm-scene');
  }

  preload() {
    this.load.svg('quest-star', '/assets/pixel/quest-star.svg', { width: 32, height: 32 });
    this.load.svg('market-ribbon', '/assets/pixel/market-ribbon.svg', { width: 96, height: 32 });
    // Hand-drawn art (LPC + CC0, see public/assets/lpc/CREDITS.md).
    // Missing files fall back to procedural textures via createPixelArtTextures.
    this.load.on('loaderror', () => undefined);
    const images: Array<[string, string]> = [
      ['tile-grass', '/assets/lpc/tile-grass.png'],
      ['tile-grass-2', '/assets/lpc/tile-grass-2.png'],
      ['tile-grass-3', '/assets/lpc/tile-grass-3.png'],
      ['tile-path', '/assets/lpc/tile-path.png'],
      ['tile-water', '/assets/lpc/tile-water.png'],
      ['tile-water-2', '/assets/lpc/tile-water-2.png'],
      ['tile-water-3', '/assets/lpc/tile-water-3.png'],
      ['plot-wild', '/assets/lpc/plot-wild.png'],
      ['plot-tilled', '/assets/lpc/plot-tilled.png'],
      ['plot-watered', '/assets/lpc/plot-watered.png'],
      ['crop-seeded', '/assets/lpc/crop-seeded.png'],
      ['crop-sprout', '/assets/lpc/crop-sprout.png'],
      ['crop-turnip', '/assets/lpc/crop-turnip.png'],
      ['crop-strawberry', '/assets/lpc/crop-strawberry.png'],
      ['grass-tuft', '/assets/lpc/grass-tuft.png'],
      ['farmhouse', '/assets/lpc/farmhouse.png'],
      ['tree', '/assets/lpc/tree.png'],
    ];
    images.forEach(([key, url]) => this.load.image(key, url));
    this.load.spritesheet('player-sheet', '/assets/lpc/player-sheet.png', { frameWidth: 64, frameHeight: 64 });
    this.load.spritesheet('rowan-sheet', '/assets/lpc/rowan-sheet.png', { frameWidth: 64, frameHeight: 64 });
  }

  create() {
    createPixelArtTextures(this);
    this.createWalkAnimations();
    this.createWeatherSprites();
    this.createAmbient();
    this.createUi();
    this.bindInput();

    this.cursor = this.add.image(0, 0, 'tile-cursor').setDepth(DEPTH.weather - 10).setAlpha(0.88);

    initFarm();
    this.unsubscribeEvents = onGameEvent((events) => this.handleEvents(events));
    joinAsLocalPlayer(OFFLINE_PLAYER_ID, 'You');

    this.buildArea(this.localPlayer?.area ?? START_AREA);

    // Start playable immediately, then hand authority to the server if one
    // answers. Waiting on the network before the world draws would make a slow
    // or missing server look like a broken game.
    void this.goOnline();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribeEvents?.();
      this.unsubscribeEvents = null;
      this.stopAutosave?.();
      this.stopAutosave = null;
      this.connection?.disconnect();
      this.connection = null;
    });

    this.refreshUi();
  }

  update(time: number, delta: number) {
    this.handleToolHotkeys();
    this.handleMovement(delta, time);
    this.handleInteractions();
    // Online the server drives time for everyone; offline this client does.
    if (!farmStore.getState().online) dispatch({ type: 'world/tick', deltaMs: delta });

    // The local player may have walked through a doorway since the last frame.
    const area = this.localPlayer?.area;
    if (area && area !== this.builtArea) this.buildArea(area);

    this.syncAvatars();
    this.updateCursor();
    this.updateAtmosphere(delta);
    this.refreshUi();
  }

  private async goOnline() {
    this.connection = await connectToFarm(import.meta.env.VITE_GAME_SERVER);
    // Browser saves are for offline play only; online, the server owns the farm.
    if (!this.connection) this.stopAutosave = startAutosave();
  }

  // --- state plumbing -------------------------------------------------------

  private get farm() {
    return farmStore.getState().farm;
  }

  private get localPlayer(): PlayerState | null {
    const { farm, localPlayerId } = farmStore.getState();
    return localPlayerId ? (farm.players[localPlayerId] ?? null) : null;
  }

  /** Turns simulation events into sprites, tweens, and re-renders. */
  private handleEvents(events: GameEvent[]) {
    for (const event of events) {
      if (event.kind === 'plotChanged') {
        this.refreshPlot(event.key);
      } else if (event.kind === 'dayStarted') {
        this.updateWeatherPresentation();
      } else if (event.kind === 'farmReplaced') {
        this.buildArea(this.localPlayer?.area ?? START_AREA);
      }
    }
  }

  // --- input ----------------------------------------------------------------

  private bindInput() {
    const keyboard = this.input.keyboard;
    if (!keyboard) return;
    this.keys = keyboard.addKeys({
      up: Phaser.Input.Keyboard.KeyCodes.W,
      down: Phaser.Input.Keyboard.KeyCodes.S,
      left: Phaser.Input.Keyboard.KeyCodes.A,
      right: Phaser.Input.Keyboard.KeyCodes.D,
      arrowUp: Phaser.Input.Keyboard.KeyCodes.UP,
      arrowDown: Phaser.Input.Keyboard.KeyCodes.DOWN,
      arrowLeft: Phaser.Input.Keyboard.KeyCodes.LEFT,
      arrowRight: Phaser.Input.Keyboard.KeyCodes.RIGHT,
      one: Phaser.Input.Keyboard.KeyCodes.ONE,
      two: Phaser.Input.Keyboard.KeyCodes.TWO,
      three: Phaser.Input.Keyboard.KeyCodes.THREE,
      four: Phaser.Input.Keyboard.KeyCodes.FOUR,
      five: Phaser.Input.Keyboard.KeyCodes.FIVE,
      q: Phaser.Input.Keyboard.KeyCodes.Q,
      space: Phaser.Input.Keyboard.KeyCodes.SPACE,
      enter: Phaser.Input.Keyboard.KeyCodes.ENTER,
    }) as KeyMap;
  }

  private handleMovement(delta: number, time: number) {
    if (!this.keys) return;
    const left = this.keys.left.isDown || this.keys.arrowLeft.isDown;
    const right = this.keys.right.isDown || this.keys.arrowRight.isDown;
    const up = this.keys.up.isDown || this.keys.arrowUp.isDown;
    const down = this.keys.down.isDown || this.keys.arrowDown.isDown;
    const dx = (right ? 1 : 0) - (left ? 1 : 0);
    const dy = (down ? 1 : 0) - (up ? 1 : 0);

    // Reported every frame, releases included: the server holds the last input
    // it was told about, so it has to hear when the player stops.
    sendMove(dx, dy, delta);
    if (dx === 0 && dy === 0) return;

    const player = this.localPlayer;
    if (!player) return;

    // Dust puffs are pure decoration, so they stay here rather than in state.
    this.dustTimer += delta;
    if (this.dustTimer > 220) {
      this.dustTimer = 0;
      const dust = this.add
        .image(player.x + Phaser.Math.Between(-6, 6), player.y + 13, 'dust')
        .setDepth(Math.floor(player.y / TILE_SIZE) + 39)
        .setScale(0.7)
        .setAlpha(0.7);
      this.areaLayer?.add(dust);
      this.tweens.add({ targets: dust, y: dust.y - 8, alpha: 0, scale: 1.1, duration: 420, onComplete: () => dust.destroy() });
    }

    const avatar = this.avatars.get(player.id);
    if (avatar && !this.anims.exists(`player-walk-${player.facing}`)) {
      avatar.sprite.setAngle(Math.sin(time / 130) * 1.5);
    }
  }

  private handleToolHotkeys() {
    if (!this.keys) return;
    const hotkeys = [this.keys.one, this.keys.two, this.keys.three, this.keys.four, this.keys.five];
    hotkeys.forEach((key, index) => {
      if (Phaser.Input.Keyboard.JustDown(key)) {
        sendAction({ type: 'selectTool', tool: TOOL_ORDER[index] });
      }
    });

    if (Phaser.Input.Keyboard.JustDown(this.keys.q)) {
      sendAction({ type: 'cycleSeed' });
    }
  }

  private handleInteractions() {
    if (!this.keys) return;
    if (!Phaser.Input.Keyboard.JustDown(this.keys.space) && !Phaser.Input.Keyboard.JustDown(this.keys.enter)) return;
    sendAction({ type: 'act' });
  }

  // --- world building -------------------------------------------------------

  /**
   * Draws one area from scratch and points the camera at it.
   *
   * Everything area-specific lives in a group, so a rebuild is one destroy call
   * rather than a teardown list that has to be kept in step with a list of
   * constructors.
   */
  private buildArea(area: AreaId) {
    this.areaLayer?.destroy(true);
    this.plotSprites.clear();
    this.cropSprites.clear();
    this.sparkles.clear();
    this.waterSprites = [];
    this.avatars.clear();
    this.questIcon = null;
    this.houseGlow = null;
    this.chimney = null;

    this.areaLayer = this.add.group();
    this.builtArea = area;

    const map = areaMap(area);
    this.renderTiles(map, area);
    this.renderProps(map);
    this.renderScatter(map);

    this.cameras.main.setBounds(0, 0, map.pixelWidth, map.pixelHeight);

    this.refreshAllPlots();
    // Force the weather presentation to reapply against the new camera.
    this.lastWeather = '';
    this.updateWeatherPresentation();
  }

  private renderTiles(map: AreaMap, area: AreaId) {
    for (let y = 0; y < map.height; y += 1) {
      for (let x = 0; x < map.width; x += 1) {
        const tile = map.tiles[y * map.width + x];
        if (!tile) continue;
        const image = this.add
          .image(x * TILE_SIZE + TILE_SIZE / 2, y * TILE_SIZE + TILE_SIZE / 2, tile.texture)
          .setDepth(0);
        this.areaLayer?.add(image);
        if (tile.kind === 'plot') this.plotSprites.set(plotKey(area, x, y), image);
        if (tile.kind === 'water') this.waterSprites.push(image);
      }
    }
  }

  private renderProps(map: AreaMap) {
    for (const prop of map.props) {
      const centreX = prop.x + prop.width / 2;
      const centreY = prop.y + prop.height / 2;

      if (prop.texture === 'rowan') {
        const hasSheet = this.textures.exists('rowan-sheet');
        const shadow = this.add.image(centreX, centreY + 16, 'shadow').setDepth(prop.depth - 1);
        const sprite = this.add
          .sprite(centreX, centreY, hasSheet ? 'rowan-sheet' : 'rowan', hasSheet ? WALK_ROW.down * 9 : undefined)
          .setDepth(prop.depth)
          .setScale(hasSheet ? 0.6 : 1.15);
        const icon = this.add.image(centreX, centreY - 26, 'quest-star').setDepth(prop.depth + 5);
        this.areaLayer?.addMultiple([shadow, sprite, icon]);
        this.questIcon = icon;
        this.tweens.add({ targets: icon, y: icon.y - 6, yoyo: true, repeat: -1, duration: 900, ease: 'Sine.inOut' });
        continue;
      }

      const image = this.add.image(centreX, centreY, prop.texture).setDepth(prop.depth);
      // Props are sized by their Tiled footprint, so resizing one in the editor
      // resizes it in game without touching this file.
      image.setDisplaySize(prop.width, prop.height);
      this.areaLayer?.add(image);

      if (prop.texture === 'farmhouse') {
        const shadow = this.add
          .image(centreX, prop.y + prop.height, 'shadow-soft')
          .setDepth(prop.depth - 1)
          .setScale(3.2, 2.4)
          .setAlpha(0.85);
        const glow = this.add.image(centreX, centreY, 'glow').setDepth(prop.depth + 2).setScale(2.6).setAlpha(0);
        this.areaLayer?.addMultiple([shadow, glow]);
        this.houseGlow = glow;
        this.chimney = { x: centreX + prop.width / 3, y: prop.y - 6 };
      }

      if (prop.texture === 'tree') {
        const shadow = this.add
          .image(centreX, prop.y + prop.height, 'shadow-soft')
          .setDepth(prop.depth - 1)
          .setScale(1.5, 1.1)
          .setAlpha(0.8);
        this.areaLayer?.add(shadow);
        this.tweens.add({
          targets: image,
          angle: (prop.x / TILE_SIZE) % 2 === 0 ? 1.4 : -1.4,
          yoyo: true,
          repeat: -1,
          duration: 2400 + ((prop.x / TILE_SIZE) % 5) * 400,
          ease: 'Sine.inOut',
        });
      }
    }
  }

  /** Grass tufts, scattered deterministically so an area always looks the same. */
  private renderScatter(map: AreaMap) {
    let placed = 0;
    const limit = Math.floor((map.width * map.height) / 28);
    for (let y = 0; y < map.height && placed < limit; y += 1) {
      for (let x = 0; x < map.width && placed < limit; x += 1) {
        if (map.tiles[y * map.width + x]?.kind !== 'grass') continue;
        if ((x * 13 + y * 29) % 11 !== 0) continue;
        const tuft = this.add
          .image(x * TILE_SIZE + 16, y * TILE_SIZE + 18, 'grass-tuft')
          .setDepth(y)
          .setAlpha(0.95);
        this.areaLayer?.add(tuft);
        placed += 1;
      }
    }
  }

  private createWalkAnimations() {
    if (!this.textures.exists('player-sheet')) return;
    (['up', 'left', 'down', 'right'] as Direction[]).forEach((dir) => {
      const key = `player-walk-${dir}`;
      if (this.anims.exists(key)) return;
      this.anims.create({
        key,
        frames: this.anims.generateFrameNumbers('player-sheet', {
          start: WALK_ROW[dir] * 9 + 1,
          end: WALK_ROW[dir] * 9 + 8,
        }),
        frameRate: 10,
        repeat: -1,
      });
    });
  }

  // --- avatars --------------------------------------------------------------

  private createAvatar(player: PlayerState): Avatar {
    const hasSheet = this.textures.exists('player-sheet');
    const shadow = this.add.image(player.x, player.y + 16, 'shadow');
    const sprite = this.add
      .sprite(player.x, player.y, hasSheet ? 'player-sheet' : 'player', hasSheet ? WALK_ROW.down * 9 : undefined)
      .setScale(hasSheet ? 0.62 : 1.2);
    // Remote players are tinted so they read as somebody else at a glance.
    if (player.id !== farmStore.getState().localPlayerId) sprite.setTint(0xbfd8ff);
    this.areaLayer?.addMultiple([shadow, sprite]);
    return { sprite, shadow, lastX: player.x, lastY: player.y };
  }

  /**
   * Draws the players standing on the built area, adding and removing avatars
   * as people arrive, leave, or walk through a doorway to somewhere else.
   */
  private syncAvatars() {
    const { farm, localPlayerId } = farmStore.getState();
    // Members who are logged out keep their place in the world but are not
    // standing in it, so they are not drawn.
    const here = Object.values(farm.players).filter(
      (player) => player.online && player.area === this.builtArea,
    );
    const present = new Set(here.map((player) => player.id));

    for (const player of here) {
      let avatar = this.avatars.get(player.id);
      if (!avatar) {
        avatar = this.createAvatar(player);
        this.avatars.set(player.id, avatar);
        if (player.id === localPlayerId) this.cameras.main.startFollow(avatar.sprite, true, 0.12, 0.12);
      }

      const moved = Math.abs(player.x - avatar.lastX) > 0.01 || Math.abs(player.y - avatar.lastY) > 0.01;
      avatar.sprite.setPosition(player.x, player.y);
      avatar.sprite.setDepth(Math.floor(player.y / TILE_SIZE) + 40);
      avatar.shadow.setPosition(player.x, player.y + 16);
      avatar.shadow.setDepth(avatar.sprite.depth - 1);

      const walkKey = `player-walk-${player.facing}`;
      if (this.anims.exists(walkKey)) {
        if (moved) avatar.sprite.anims.play(walkKey, true);
        else {
          avatar.sprite.anims.stop();
          avatar.sprite.setFrame(WALK_ROW[player.facing] * 9);
        }
      }

      avatar.lastX = player.x;
      avatar.lastY = player.y;
    }

    for (const [id, avatar] of this.avatars) {
      if (present.has(id)) continue;
      avatar.sprite.destroy();
      avatar.shadow.destroy();
      this.avatars.delete(id);
    }
  }

  // --- screen-space effects --------------------------------------------------
  //
  // Weather, overlays, and the HUD are pinned to the camera rather than to the
  // world, so they cover the viewport instead of one corner of a large map.

  private createWeatherSprites() {
    for (let i = 0; i < 58; i += 1) {
      const drop = this.add
        .image((i * 73) % GAME_WIDTH, (i * 43) % GAME_HEIGHT, 'rain-drop')
        .setScrollFactor(0)
        .setDepth(DEPTH.weather)
        .setAlpha(0);
      this.rainDrops.push(drop);
    }

    for (let i = 0; i < 20; i += 1) {
      const firefly = this.add
        .image((i * 131) % GAME_WIDTH, 80 + ((i * 47) % 420), 'firefly')
        .setScrollFactor(0)
        .setDepth(DEPTH.weather + 1)
        .setAlpha(0);
      this.fireflies.push(firefly);
      this.tweens.add({
        targets: firefly,
        x: firefly.x + 16,
        y: firefly.y - 12,
        yoyo: true,
        repeat: -1,
        duration: 1200 + i * 35,
        ease: 'Sine.inOut',
      });
    }
  }

  private createAmbient() {
    for (let i = 0; i < 4; i += 1) {
      const cloud = this.add
        .image((i * 317) % GAME_WIDTH, 40 + ((i * 97) % 200), 'cloud-shadow')
        .setScrollFactor(0)
        .setDepth(DEPTH.weather - 2)
        .setAlpha(0.8)
        .setScale(1 + (i % 3) * 0.4);
      this.clouds.push(cloud);
    }
    for (let i = 0; i < 14; i += 1) {
      const petal = this.add
        .image((i * 173) % GAME_WIDTH, (i * 89) % GAME_HEIGHT, i % 3 === 0 ? 'petal' : 'firefly')
        .setScrollFactor(0)
        .setDepth(DEPTH.weather + 2)
        .setAlpha(i % 3 === 0 ? 0.85 : 0);
      petal.setData('seed', i * 1.7);
      petal.setData('isPetal', i % 3 === 0);
      this.petals.push(petal);
    }
    for (let i = 0; i < 3; i += 1) {
      const b = this.add
        .image(200 + i * 220, 200 + ((i * 130) % 240), 'butterfly')
        .setScrollFactor(0)
        .setDepth(DEPTH.weather + 3)
        .setScale(1.2);
      this.tweens.add({
        targets: b,
        x: b.x + 42,
        y: b.y - 26,
        yoyo: true,
        repeat: -1,
        duration: 2600 + i * 700,
        ease: 'Sine.inOut',
      });
      this.tweens.add({ targets: b, scaleX: 0.6, yoyo: true, repeat: -1, duration: 180, ease: 'Sine.inOut' });
      this.butterflies.push(b);
    }
  }

  private createUi() {
    this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT - 31, GAME_WIDTH - 28, 50, 0x2b1f18, 0.78)
      .setStrokeStyle(2, 0xf1cc7b, 0.32)
      .setScrollFactor(0)
      .setDepth(DEPTH.hud);
    this.toolbarText = this.add
      .text(24, GAME_HEIGHT - 50, '', { fontFamily: 'Nunito, monospace', fontSize: '14px', color: '#fff1c2' })
      .setScrollFactor(0)
      .setDepth(DEPTH.hud + 1);
    this.promptText = this.add
      .text(24, GAME_HEIGHT - 27, '', { fontFamily: 'Nunito, monospace', fontSize: '13px', color: '#d9f7c7' })
      .setScrollFactor(0)
      .setDepth(DEPTH.hud + 1);
    this.clockText = this.add
      .text(GAME_WIDTH - 22, 18, '', {
        fontFamily: 'Fredoka, Nunito, monospace',
        fontSize: '16px',
        color: '#fff1c2',
        align: 'right',
        backgroundColor: 'rgba(43,31,24,0.72)',
        padding: { x: 10, y: 6 },
      })
      .setOrigin(1, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH.hud + 1);
    this.weatherText = this.add
      .text(22, 18, '', {
        fontFamily: 'Fredoka, Nunito, monospace',
        fontSize: '15px',
        color: '#fff1c2',
        backgroundColor: 'rgba(43,31,24,0.72)',
        padding: { x: 10, y: 6 },
      })
      .setScrollFactor(0)
      .setDepth(DEPTH.hud + 1);

    this.dayNightOverlay = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x111733, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH.overlay);
    this.sunsetOverlay = this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0xff8a4c, 0)
      .setScrollFactor(0)
      .setDepth(DEPTH.overlay - 1);
    this.add
      .rectangle(GAME_WIDTH / 2, 8, GAME_WIDTH, 16, 0x000000, 0.22)
      .setScrollFactor(0)
      .setDepth(DEPTH.overlay + 1);
    this.add
      .rectangle(GAME_WIDTH / 2, GAME_HEIGHT - 8, GAME_WIDTH, 16, 0x000000, 0.25)
      .setScrollFactor(0)
      .setDepth(DEPTH.overlay + 1);
  }

  private updateAtmosphere(delta: number) {
    const farm = this.farm;
    const time = this.time.now / 1000;

    this.waterTimer += delta;
    if (this.waterTimer > 380 && this.textures.exists('tile-water-2') && this.textures.exists('tile-water-3')) {
      this.waterTimer = 0;
      this.waterFrame = (this.waterFrame + 1) % 3;
      const key = this.waterFrame === 0 ? 'tile-water' : this.waterFrame === 1 ? 'tile-water-2' : 'tile-water-3';
      this.waterSprites.forEach((sprite) => sprite.setTexture(key));
    }
    this.waterSprites.forEach((sprite, i) => {
      sprite.setAlpha(0.96 + Math.sin(time * 2 + i * 0.7) * 0.04);
    });

    this.clouds.forEach((cloud, i) => {
      cloud.x += delta * 0.008 * (1 + (i % 3) * 0.4);
      if (cloud.x > GAME_WIDTH + 100) cloud.x = -100;
    });

    const fireflyNight = farm.weather === 'Firefly Shower' || farm.time.hour >= 19 || farm.time.hour < 6;
    this.petals.forEach((petal) => {
      const seed = Number(petal.getData('seed') ?? 0);
      const isPetal = Boolean(petal.getData('isPetal'));
      petal.y += delta * 0.012;
      petal.x += Math.sin(time * 1.2 + seed) * delta * 0.01;
      petal.setAngle(Math.sin(time + seed) * 18);
      if (petal.y > GAME_HEIGHT + 12) {
        petal.y = -12;
        petal.x = (seed * 137) % GAME_WIDTH;
      }
      if (!isPetal) petal.setAlpha(fireflyNight ? 0.7 + Math.sin(time * 3 + seed) * 0.25 : 0);
    });

    if (this.chimney) {
      this.smokeTimer += delta;
      if (this.smokeTimer > 900) {
        this.smokeTimer = 0;
        const smoke = this.add
          .image(this.chimney.x + Phaser.Math.Between(-2, 2), this.chimney.y, 'smoke')
          .setDepth(7)
          .setScale(0.5)
          .setAlpha(0.6);
        this.areaLayer?.add(smoke);
        this.tweens.add({
          targets: smoke,
          y: smoke.y - 34,
          x: smoke.x + 10,
          scale: 1.2,
          alpha: 0,
          duration: 2400,
          onComplete: () => smoke.destroy(),
        });
      }
    }

    const hour = farm.time.hour + farm.time.minute / 60;
    const eveningAlpha = Phaser.Math.Clamp((hour - 18) / 4, 0, 0.42);
    const dawnAlpha = Phaser.Math.Clamp((7 - hour) / 2, 0, 0.18);
    this.dayNightOverlay.setAlpha(Math.max(eveningAlpha, dawnAlpha));
    const sunset = hour >= 16.5 && hour <= 19 ? Math.sin(((hour - 16.5) / 2.5) * Math.PI) * 0.16 : 0;
    this.sunsetOverlay.setAlpha(sunset);

    if (this.houseGlow) {
      const nightGlow = hour >= 18 || hour < 6.5 ? 0.75 : hour >= 17 ? 0.35 : 0;
      this.houseGlow.setAlpha(nightGlow + Math.sin(time * 2.2) * 0.05);
    }

    const showButterflies = farm.weather !== 'Drizzle' && hour >= 8 && hour < 18;
    this.butterflies.forEach((b) => b.setVisible(showButterflies));

    const rainy = farm.weather === 'Drizzle';
    this.rainDrops.forEach((drop, index) => {
      if (!rainy) return;
      drop.y += delta * (0.28 + (index % 5) * 0.018);
      drop.x += delta * 0.05;
      if (drop.y > GAME_HEIGHT + 10) {
        drop.y = -10;
        drop.x = (drop.x + 173) % GAME_WIDTH;
      }
    });
  }

  private updateWeatherPresentation() {
    const { weather } = this.farm;
    if (weather === this.lastWeather) return;
    this.lastWeather = weather;
    const rainy = weather === 'Drizzle';
    const fireflyWeather = weather === 'Firefly Shower';
    this.rainDrops.forEach((drop) => drop.setAlpha(rainy ? 0.72 : 0));
    this.fireflies.forEach((fly) => fly.setAlpha(fireflyWeather ? 0.85 : 0));
    this.cameras.main.setBackgroundColor(rainy ? '#203142' : fireflyWeather ? '#1c2636' : '#1a2d1c');
  }

  // --- plots ----------------------------------------------------------------

  private refreshAllPlots() {
    for (const key of this.plotSprites.keys()) this.refreshPlot(key);
  }

  /**
   * Redraws one plot. Keys carry their area, so a plot that changed on another
   * map simply has no sprite here and is skipped.
   */
  private refreshPlot(key: string) {
    const plot = this.farm.plots[key];
    const base = this.plotSprites.get(key);
    if (!plot || !base) return;

    const { x, y } = plot;
    base.setTexture(plot.wateredToday ? 'plot-watered' : plot.stage === 'wild' ? 'plot-wild' : 'plot-tilled');

    this.cropSprites.get(key)?.destroy();
    this.cropSprites.delete(key);
    this.sparkles.get(key)?.destroy();
    this.sparkles.delete(key);

    if (!plot.crop) return;
    const cropTexture =
      plot.stage === 'mature'
        ? plot.crop === 'turnip'
          ? 'crop-turnip'
          : 'crop-strawberry'
        : plot.stage === 'sprout'
          ? 'crop-sprout'
          : 'crop-seeded';
    const crop = this.add.image(x * TILE_SIZE + 16, y * TILE_SIZE + 16, cropTexture).setDepth(y + 2);
    this.areaLayer?.add(crop);
    this.cropSprites.set(key, crop);

    if (plot.stage === 'sprout' || plot.stage === 'mature') {
      this.tweens.add({ targets: crop, angle: 2.2, yoyo: true, repeat: -1, duration: 1600 + (x + y) * 40, ease: 'Sine.inOut' });
    }
    if (plot.stage === 'mature') {
      const sparkle = this.add.image(x * TILE_SIZE + 22, y * TILE_SIZE + 6, 'sparkle').setDepth(y + 3).setScale(0.8);
      this.areaLayer?.add(sparkle);
      this.sparkles.set(key, sparkle);
      this.tweens.add({ targets: sparkle, alpha: 0.2, scale: 1.2, yoyo: true, repeat: -1, duration: 700, ease: 'Sine.inOut' });
      crop.setScale(0.6);
      this.tweens.add({ targets: crop, scale: 1, duration: 260, ease: 'Back.easeOut' });
    }
  }

  // --- hud ------------------------------------------------------------------

  private refreshUi() {
    const store = farmStore.getState();
    const farm = store.farm;
    const player = this.localPlayer;
    if (!player) return;

    const seedLabel = CROP_DEFINITIONS[player.seed].label;
    const tools = TOOL_ORDER.map(
      (tool, index) => `${index + 1}${tool === player.tool ? '▶' : ':'}${TOOL_LABELS[tool]}`,
    ).join('  ');
    this.toolbarText.setText(`${tools}   Q: ${seedLabel} seeds`);
    this.promptText.setText(promptFor(store));
    this.clockText.setText(`Day ${farm.time.day} ${this.formatClock()}\n${farm.season}`);
    this.weatherText.setText(
      `${areaMap(player.area).name}\n${farm.weather} • Quest ${farm.quest.progress}/${farm.quest.target}`,
    );
    this.questIcon?.setVisible(!farm.quest.rewarded);
  }

  private updateCursor() {
    const player = this.localPlayer;
    if (!player || !this.builtArea) return;
    const target = targetTile(player.area, player, player.facing);
    const tx = target.x * TILE_SIZE + 16;
    const ty = target.y * TILE_SIZE + 16;
    this.cursor.x = Phaser.Math.Linear(this.cursor.x, tx, 0.35);
    this.cursor.y = Phaser.Math.Linear(this.cursor.y, ty, 0.35);
    this.cursor.setVisible(tileAt(player.area, target.x, target.y)?.kind !== 'water');
    this.cursor.setAlpha(0.82 + Math.sin(this.time.now / 280) * 0.1);
    this.cursor.setAngle(Math.sin(this.time.now / 900) * 2);
  }

  private formatClock() {
    const { time } = this.farm;
    const minutes = time.minute.toString().padStart(2, '0');
    const suffix = time.hour >= 12 ? 'PM' : 'AM';
    const displayHours = time.hour % 12 === 0 ? 12 : time.hour % 12;
    return `${displayHours}:${minutes} ${suffix}`;
  }
}
