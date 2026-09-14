import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../constants';
import { createPixelArtTextures } from '../assets/createPixelArtTextures';
import type { GameEvent } from '../state/intents';
import { promptFor } from '../state/selectors';
import { dispatch, farmStore, joinAsLocalPlayer, onGameEvent, resetFarm } from '../state/store';
import { TOOL_LABELS, TOOL_ORDER, type PlayerId, type PlayerState } from '../state/types';
import { CROP_DEFINITIONS } from '../systems/farming';
import {
  LANDMARKS,
  MAP_HEIGHT,
  MAP_WIDTH,
  TILE_SIZE,
  createMap,
  plotKey,
  targetTile,
  type Direction,
  type TileKind,
} from '../world/layout';

type KeyMap = Record<string, Phaser.Input.Keyboard.Key>;

/** LPC walkcycle rows: 0 = up, 1 = left, 2 = down, 3 = right (9 frames each). */
const WALK_ROW: Record<Direction, number> = { up: 0, left: 1, down: 2, right: 3 };

const LOCAL_PLAYER_ID = 'local';

interface Avatar {
  sprite: Phaser.GameObjects.Sprite;
  shadow: Phaser.GameObjects.Image;
  lastX: number;
  lastY: number;
}

/**
 * Renders the farm and turns input into intents.
 *
 * The scene owns no game state. Everything it draws it reads from the farm
 * store, and every change it makes it requests through `dispatch`. That keeps
 * the simulation testable without Phaser and lets the server become the
 * authority later without touching this file.
 */
export default class FarmScene extends Phaser.Scene {
  private map: TileKind[][] = [];
  private plotSprites = new Map<string, Phaser.GameObjects.Image>();
  private cropSprites = new Map<string, Phaser.GameObjects.Image>();
  private avatars = new Map<PlayerId, Avatar>();
  private rowan!: Phaser.GameObjects.Sprite;
  private rowanShadow!: Phaser.GameObjects.Image;
  private waterSprites: Phaser.GameObjects.Image[] = [];
  private questIcon!: Phaser.GameObjects.Image;
  private cursor!: Phaser.GameObjects.Image;
  private market!: Phaser.GameObjects.Image;
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
  private treeSprites: Phaser.GameObjects.Image[] = [];
  private houseGlow!: Phaser.GameObjects.Image;
  private chimneyX = 0;
  private chimneyY = 0;
  private smokeTimer = 0;
  private dustTimer = 0;
  private waterTimer = 0;
  private waterFrame = 0;
  private sparkles = new Map<string, Phaser.GameObjects.Image>();
  private lastWeather = '';
  private unsubscribeEvents: (() => void) | null = null;

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
    this.map = createMap();
    this.renderMap();
    this.createScenery();
    this.createCharacters();
    this.createWeatherSprites();
    this.createAmbient();
    this.createUi();
    this.bindInput();

    resetFarm();
    this.unsubscribeEvents = onGameEvent((events) => this.handleEvents(events));
    joinAsLocalPlayer(LOCAL_PLAYER_ID, 'You');

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.unsubscribeEvents?.();
      this.unsubscribeEvents = null;
    });

    this.refreshAllPlots();
    this.updateWeatherPresentation();
    this.refreshUi();
  }

  update(time: number, delta: number) {
    this.handleToolHotkeys();
    this.handleMovement(delta, time);
    this.handleInteractions();
    dispatch({ type: 'world/tick', deltaMs: delta });
    this.syncAvatars(delta);
    this.updateCursor();
    this.updateAtmosphere(delta);
    this.refreshUi();
  }

  // --- state plumbing -------------------------------------------------------

  private get farm() {
    return farmStore.getState().farm;
  }

  private get localPlayer(): PlayerState | null {
    return this.farm.players[LOCAL_PLAYER_ID] ?? null;
  }

  /** Turns simulation events into sprites, tweens, and re-renders. */
  private handleEvents(events: GameEvent[]) {
    for (const event of events) {
      if (event.kind === 'plotChanged') {
        const plot = this.farm.plots[event.key];
        if (plot) this.refreshPlot(plot.x, plot.y);
      } else if (event.kind === 'dayStarted') {
        this.updateWeatherPresentation();
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
    if (dx === 0 && dy === 0) return;

    dispatch({ type: 'player/move', playerId: LOCAL_PLAYER_ID, dx, dy, deltaMs: delta });

    const player = this.localPlayer;
    if (!player) return;

    // Dust puffs are pure decoration, so they stay here rather than in state.
    this.dustTimer += delta;
    if (this.dustTimer > 220) {
      this.dustTimer = 0;
      const dust = this.add
        .image(player.x + Phaser.Math.Between(-6, 6), player.y + 13, 'dust')
        .setDepth(48)
        .setScale(0.7)
        .setAlpha(0.7);
      this.tweens.add({ targets: dust, y: dust.y - 8, alpha: 0, scale: 1.1, duration: 420, onComplete: () => dust.destroy() });
    }

    const avatar = this.avatars.get(LOCAL_PLAYER_ID);
    if (avatar && !this.anims.exists(`player-walk-${player.facing}`)) {
      avatar.sprite.setAngle(Math.sin(time / 130) * 1.5);
    }
  }

  private handleToolHotkeys() {
    if (!this.keys) return;
    const hotkeys = [this.keys.one, this.keys.two, this.keys.three, this.keys.four, this.keys.five];
    hotkeys.forEach((key, index) => {
      if (Phaser.Input.Keyboard.JustDown(key)) {
        dispatch({ type: 'player/selectTool', playerId: LOCAL_PLAYER_ID, tool: TOOL_ORDER[index] });
      }
    });

    if (Phaser.Input.Keyboard.JustDown(this.keys.q)) {
      dispatch({ type: 'player/cycleSeed', playerId: LOCAL_PLAYER_ID });
    }
  }

  private handleInteractions() {
    if (!this.keys) return;
    if (!Phaser.Input.Keyboard.JustDown(this.keys.space) && !Phaser.Input.Keyboard.JustDown(this.keys.enter)) return;
    dispatch({ type: 'player/act', playerId: LOCAL_PLAYER_ID });
  }

  // --- rendering ------------------------------------------------------------

  private renderMap() {
    for (let y = 0; y < MAP_HEIGHT; y += 1) {
      for (let x = 0; x < MAP_WIDTH; x += 1) {
        const tile = this.map[y][x];
        const variant = (x * 31 + y * 17) % 10;
        const grassKey = variant < 6 ? 'tile-grass' : variant < 8 ? 'tile-grass-2' : 'tile-grass-3';
        const key = tile === 'water' ? 'tile-water' : tile === 'path' ? 'tile-path' : tile === 'plot' ? 'plot-wild' : grassKey;
        const image = this.add.image(x * TILE_SIZE + 16, y * TILE_SIZE + 16, key).setDepth(y);
        if (tile === 'plot') this.plotSprites.set(plotKey(x, y), image);
        if (tile === 'water') this.waterSprites.push(image);
      }
    }
  }

  private createScenery() {
    this.add.image(LANDMARKS.farmhouse.x, LANDMARKS.farmhouse.y, 'farmhouse').setDepth(4).setDisplaySize(150, 150);
    this.add.image(LANDMARKS.farmhouse.x, 3.5 * TILE_SIZE, 'shadow-soft').setDepth(3).setScale(3.2, 2.4).setAlpha(0.85);
    this.houseGlow = this.add.image(LANDMARKS.farmhouse.x, 2.9 * TILE_SIZE, 'glow').setDepth(6).setScale(2.6).setAlpha(0);
    this.chimneyX = LANDMARKS.farmhouse.x + 49;
    this.chimneyY = LANDMARKS.farmhouse.y - 50;
    const treePositions: Array<[number, number, number]> = [
      [2.5, 12.3, 13],
      [25.4, 3.7, 5],
      [27.2, 12.5, 13],
    ];
    treePositions.forEach(([tx, ty, depth], i) => {
      this.add.image(tx * TILE_SIZE, ty * TILE_SIZE + 28, 'shadow-soft').setDepth(depth - 1).setScale(1.5, 1.1).setAlpha(0.8);
      const tree = this.add.image(tx * TILE_SIZE, ty * TILE_SIZE, 'tree').setDepth(depth).setDisplaySize(48, 68);
      this.treeSprites.push(tree);
      this.tweens.add({
        targets: tree,
        angle: i % 2 === 0 ? 1.4 : -1.4,
        yoyo: true,
        repeat: -1,
        duration: 2400 + i * 400,
        ease: 'Sine.inOut',
      });
    });
    // scattered tufts + flowers on grass only
    let placed = 0;
    for (let y = 0; y < MAP_HEIGHT && placed < 34; y += 1) {
      for (let x = 0; x < MAP_WIDTH && placed < 34; x += 1) {
        if (this.map[y]?.[x] !== 'grass') continue;
        if ((x * 13 + y * 29) % 11 !== 0) continue;
        this.add.image(x * TILE_SIZE + 16, y * TILE_SIZE + 18, 'grass-tuft').setDepth(y + 1).setAlpha(0.95);
        placed += 1;
      }
    }
    this.market = this.add.image(LANDMARKS.market.x, LANDMARKS.market.y, 'market-ribbon').setDepth(8).setScale(1.1);

    const well = this.add.container(22 * TILE_SIZE, 8 * TILE_SIZE).setDepth(9);
    well.add(this.add.rectangle(0, 8, 48, 20, 0x6e5846).setStrokeStyle(2, 0x2e211b));
    well.add(this.add.rectangle(0, -3, 34, 18, 0x93b5bd).setStrokeStyle(2, 0x324b55));
    well.add(this.add.rectangle(0, -16, 54, 7, 0x7b4328));
  }

  private createCharacters() {
    this.rowanShadow = this.add.image(LANDMARKS.rowan.x, LANDMARKS.rowan.y + 16, 'shadow').setDepth(39);
    const rowanFrames = this.textures.exists('rowan-sheet');
    this.rowan = this.add
      .sprite(LANDMARKS.rowan.x, LANDMARKS.rowan.y, rowanFrames ? 'rowan-sheet' : 'rowan', rowanFrames ? WALK_ROW.down * 9 : undefined)
      .setDepth(40)
      .setScale(rowanFrames ? 0.6 : 1.15);

    if (this.textures.exists('player-sheet')) {
      (['up', 'left', 'down', 'right'] as Direction[]).forEach((dir) => {
        const row = WALK_ROW[dir];
        const key = `player-walk-${dir}`;
        if (!this.anims.exists(key)) {
          this.anims.create({
            key,
            frames: this.anims.generateFrameNumbers('player-sheet', { start: row * 9 + 1, end: row * 9 + 8 }),
            frameRate: 10,
            repeat: -1,
          });
        }
      });
    }

    this.questIcon = this.add.image(LANDMARKS.rowan.x, 6.45 * TILE_SIZE, 'quest-star').setDepth(45);
    this.tweens.add({ targets: this.questIcon, y: this.questIcon.y - 6, yoyo: true, repeat: -1, duration: 900, ease: 'Sine.inOut' });
    this.cursor = this.add.image(15 * TILE_SIZE + 16, 14 * TILE_SIZE + 16, 'tile-cursor').setDepth(80).setAlpha(0.88);
  }

  /** Creates an avatar for a player who just joined the farm. */
  private createAvatar(player: PlayerState): Avatar {
    const hasSheet = this.textures.exists('player-sheet');
    const shadow = this.add.image(player.x, player.y + 16, 'shadow').setDepth(49);
    const sprite = this.add
      .sprite(player.x, player.y, hasSheet ? 'player-sheet' : 'player', hasSheet ? WALK_ROW.down * 9 : undefined)
      .setDepth(50)
      .setScale(hasSheet ? 0.62 : 1.2);
    // Remote players are tinted so they read as somebody else at a glance.
    if (player.id !== LOCAL_PLAYER_ID) sprite.setTint(0xbfd8ff);
    return { sprite, shadow, lastX: player.x, lastY: player.y };
  }

  /**
   * Draws every player the farm currently holds, adding and removing avatars
   * as people join and leave. Positions come from state, never the other way.
   */
  private syncAvatars(_delta: number) {
    const players = this.farm.players;

    for (const player of Object.values(players)) {
      let avatar = this.avatars.get(player.id);
      if (!avatar) {
        avatar = this.createAvatar(player);
        this.avatars.set(player.id, avatar);
      }

      const moved = Math.abs(player.x - avatar.lastX) > 0.01 || Math.abs(player.y - avatar.lastY) > 0.01;
      avatar.sprite.setPosition(player.x, player.y);
      avatar.sprite.setDepth(Math.floor(player.y / TILE_SIZE) + 40);
      avatar.shadow.setPosition(player.x, player.y + 16);

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
      if (players[id]) continue;
      avatar.sprite.destroy();
      avatar.shadow.destroy();
      this.avatars.delete(id);
    }
  }

  private createWeatherSprites() {
    for (let i = 0; i < 58; i += 1) {
      const drop = this.add
        .image((i * 73) % GAME_WIDTH, (i * 43) % GAME_HEIGHT, 'rain-drop')
        .setDepth(90)
        .setAlpha(0);
      this.rainDrops.push(drop);
    }

    for (let i = 0; i < 20; i += 1) {
      const firefly = this.add
        .image((i * 131) % GAME_WIDTH, 80 + ((i * 47) % 420), 'firefly')
        .setDepth(91)
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
        .setDepth(88)
        .setAlpha(0.8)
        .setScale(1 + (i % 3) * 0.4);
      this.clouds.push(cloud);
    }
    for (let i = 0; i < 14; i += 1) {
      const petal = this.add
        .image((i * 173) % GAME_WIDTH, (i * 89) % GAME_HEIGHT, i % 3 === 0 ? 'petal' : 'firefly')
        .setDepth(92)
        .setAlpha(i % 3 === 0 ? 0.85 : 0);
      petal.setData('seed', i * 1.7);
      petal.setData('isPetal', i % 3 === 0);
      this.petals.push(petal);
    }
    for (let i = 0; i < 3; i += 1) {
      const b = this.add
        .image(200 + i * 220, 200 + ((i * 130) % 240), 'butterfly')
        .setDepth(93)
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
      .setDepth(100);
    this.toolbarText = this.add
      .text(24, GAME_HEIGHT - 50, '', {
        fontFamily: 'Nunito, monospace',
        fontSize: '14px',
        color: '#fff1c2',
      })
      .setDepth(101);
    this.promptText = this.add
      .text(24, GAME_HEIGHT - 27, '', {
        fontFamily: 'Nunito, monospace',
        fontSize: '13px',
        color: '#d9f7c7',
      })
      .setDepth(101);
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
      .setDepth(101);
    this.weatherText = this.add
      .text(22, 18, '', {
        fontFamily: 'Fredoka, Nunito, monospace',
        fontSize: '15px',
        color: '#fff1c2',
        backgroundColor: 'rgba(43,31,24,0.72)',
        padding: { x: 10, y: 6 },
      })
      .setDepth(101);
    this.dayNightOverlay = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x111733, 0).setDepth(95);
    this.sunsetOverlay = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0xff8a4c, 0).setDepth(94);
    this.add.rectangle(GAME_WIDTH / 2, 8, GAME_WIDTH, 16, 0x000000, 0.22).setDepth(96);
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT - 8, GAME_WIDTH, 16, 0x000000, 0.25).setDepth(96);
  }

  private updateAtmosphere(delta: number) {
    const farm = this.farm;
    const time = this.time.now / 1000;
    // water frame animation (LPC sparkle variants) + gentle shimmer
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
    // clouds drift
    this.clouds.forEach((cloud, i) => {
      cloud.x += delta * 0.008 * (1 + (i % 3) * 0.4);
      if (cloud.x > GAME_WIDTH + 100) cloud.x = -100;
    });
    // petals / ambient motes drift
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
    // chimney smoke
    this.smokeTimer += delta;
    if (this.smokeTimer > 900) {
      this.smokeTimer = 0;
      const smoke = this.add.image(this.chimneyX + Phaser.Math.Between(-2, 2), this.chimneyY, 'smoke').setDepth(7).setScale(0.5).setAlpha(0.6);
      this.tweens.add({ targets: smoke, y: smoke.y - 34, x: smoke.x + 10, scale: 1.2, alpha: 0, duration: 2400, onComplete: () => smoke.destroy() });
    }
    const hour = farm.time.hour + farm.time.minute / 60;
    const eveningAlpha = Phaser.Math.Clamp((hour - 18) / 4, 0, 0.42);
    const dawnAlpha = Phaser.Math.Clamp((7 - hour) / 2, 0, 0.18);
    this.dayNightOverlay.setAlpha(Math.max(eveningAlpha, dawnAlpha));
    // warm sunset 16.5-19h, cool night handled by overlay
    const sunset = hour >= 16.5 && hour <= 19 ? Math.sin(((hour - 16.5) / 2.5) * Math.PI) * 0.16 : 0;
    this.sunsetOverlay.setAlpha(sunset);
    // house glow at night
    const nightGlow = hour >= 18 || hour < 6.5 ? 0.75 : hour >= 17 ? 0.35 : 0;
    this.houseGlow.setAlpha(nightGlow + Math.sin(time * 2.2) * 0.05);
    // hide butterflies at night / rain
    const showB = farm.weather !== 'Drizzle' && hour >= 8 && hour < 18;
    this.butterflies.forEach((b) => b.setVisible(showB));

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
    this.cameras.main.setBackgroundColor(
      rainy ? '#203142' : fireflyWeather ? '#1c2636' : '#1a2d1c',
    );
  }

  private refreshAllPlots() {
    for (const plot of Object.values(this.farm.plots)) this.refreshPlot(plot.x, plot.y);
  }

  private refreshPlot(x: number, y: number) {
    const key = plotKey(x, y);
    const plot = this.farm.plots[key];
    const base = this.plotSprites.get(key);
    if (!plot || !base) return;

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
    this.cropSprites.set(key, crop);
    if (plot.stage === 'sprout' || plot.stage === 'mature') {
      this.tweens.add({ targets: crop, angle: 2.2, yoyo: true, repeat: -1, duration: 1600 + (x + y) * 40, ease: 'Sine.inOut' });
    }
    if (plot.stage === 'mature') {
      const sparkle = this.add.image(x * TILE_SIZE + 22, y * TILE_SIZE + 6, 'sparkle').setDepth(y + 3).setScale(0.8);
      this.sparkles.set(key, sparkle);
      this.tweens.add({ targets: sparkle, alpha: 0.2, scale: 1.2, yoyo: true, repeat: -1, duration: 700, ease: 'Sine.inOut' });
      // pop-in juice
      crop.setScale(0.6);
      this.tweens.add({ targets: crop, scale: 1, duration: 260, ease: 'Back.easeOut' });
    }
  }

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
    this.weatherText.setText(`${farm.weather}\nQuest ${farm.quest.progress}/${farm.quest.target}`);
    this.questIcon.setVisible(!farm.quest.rewarded);
  }

  private updateCursor() {
    const player = this.localPlayer;
    if (!player) return;
    const target = targetTile(player, player.facing);
    const tx = target.x * TILE_SIZE + 16;
    const ty = target.y * TILE_SIZE + 16;
    this.cursor.x = Phaser.Math.Linear(this.cursor.x, tx, 0.35);
    this.cursor.y = Phaser.Math.Linear(this.cursor.y, ty, 0.35);
    this.cursor.setVisible(this.map[target.y][target.x] !== 'water');
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
