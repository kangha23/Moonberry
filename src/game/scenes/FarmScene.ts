import Phaser from 'phaser';
import { GAME_HEIGHT, GAME_WIDTH } from '../constants';
import { createPixelArtTextures } from '../assets/createPixelArtTextures';
import {
  applyFarmAction,
  advancePlotDay,
  CROP_DEFINITIONS,
  createPlot,
  sellAllCrops,
  type FarmAction,
  type PlotState,
} from '../systems/farming';
import { createInventory, refillWater, type CropId, type InventoryState } from '../systems/inventory';
import { claimQuestReward, createQuest, recordHarvest, type QuestState } from '../systems/quest';
import {
  advanceTime,
  createTimeState,
  isRainy,
  seasonForDay,
  weatherForDay,
  type Season,
  type TimeState,
  type Weather,
} from '../systems/time';
import type { FarmSnapshot } from '../types/snapshot';

const TILE_SIZE = 32;
const MAP_WIDTH = GAME_WIDTH / TILE_SIZE;
const MAP_HEIGHT = GAME_HEIGHT / TILE_SIZE;
const PLOT_START_X = 9;
const PLOT_START_Y = 7;
const PLOT_COLS = 8;
const PLOT_ROWS = 6;
const PLAYER_SPEED = 132;

type Direction = 'up' | 'down' | 'left' | 'right';
type TileKind = 'grass' | 'path' | 'water' | 'plot';
type Tool = 'hoe' | 'seed' | 'water' | 'harvest' | 'inspect';

type KeyMap = Record<string, Phaser.Input.Keyboard.Key>;

const TOOL_ORDER: Tool[] = ['hoe', 'seed', 'water', 'harvest', 'inspect'];
const TOOL_LABELS: Record<Tool, string> = {
  hoe: 'Hoe',
  seed: 'Seeds',
  water: 'Watering Can',
  harvest: 'Harvest Basket',
  inspect: 'Inspect',
};

const TOOL_ACTIONS: Partial<Record<Tool, FarmAction>> = {
  hoe: 'till',
  seed: 'plant',
  water: 'water',
  harvest: 'harvest',
};

const SEED_ORDER: CropId[] = ['turnip', 'strawberry'];

// LPC walkcycle rows: 0 = up, 1 = left, 2 = down, 3 = right (9 frames each).
const WALK_ROW: Record<Direction, number> = { up: 0, left: 1, down: 2, right: 3 };

function plotKey(x: number, y: number) {
  return `${x},${y}`;
}

function worldToTile(value: number) {
  return Math.floor(value / TILE_SIZE);
}

export default class FarmScene extends Phaser.Scene {
  private map: TileKind[][] = [];
  private plots = new Map<string, PlotState>();
  private plotSprites = new Map<string, Phaser.GameObjects.Image>();
  private cropSprites = new Map<string, Phaser.GameObjects.Image>();
  private player!: Phaser.GameObjects.Sprite;
  private rowan!: Phaser.GameObjects.Sprite;
  private playerShadow!: Phaser.GameObjects.Image;
  private rowanShadow!: Phaser.GameObjects.Image;
  private waterSprites: Phaser.GameObjects.Image[] = [];
  private questIcon!: Phaser.GameObjects.Image;
  private cursor!: Phaser.GameObjects.Image;
  private market!: Phaser.GameObjects.Image;
  private keys!: KeyMap;
  private facing: Direction = 'down';
  private selectedToolIndex = 0;
  private selectedSeedIndex = 0;
  private inventory: InventoryState = createInventory();
  private quest: QuestState = createQuest();
  private timeState: TimeState = createTimeState();
  private season: Season = seasonForDay(1);
  private weather: Weather = weatherForDay(1);
  private timeAccumulator = 0;
  private prompt = 'Wake up on Amberfall Farm.';
  private promptText!: Phaser.GameObjects.Text;
  private toolbarText!: Phaser.GameObjects.Text;
  private clockText!: Phaser.GameObjects.Text;
  private weatherText!: Phaser.GameObjects.Text;
  private dayNightOverlay!: Phaser.GameObjects.Rectangle;
  private sunsetOverlay!: Phaser.GameObjects.Rectangle;
  private vignetteTop!: Phaser.GameObjects.Rectangle;
  private vignetteBottom!: Phaser.GameObjects.Rectangle;
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
  private snapshotAccumulator = 0;

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
    this.createMap();
    this.renderMap();
    this.createScenery();
    this.createCharacters();
    this.createWeatherSprites();
    this.createAmbient();
    this.createUi();
    this.bindInput();
    this.updateWeatherPresentation();
    this.refreshUi();
    this.dispatchSnapshot();
  }

  update(_time: number, delta: number) {
    this.handleToolHotkeys();
    this.handleMovement(delta, _time);
    this.handleInteractions();
    this.updateCursor();
    this.advanceClock(delta);
    this.updateAtmosphere(delta);
    this.snapshotAccumulator += delta;
    if (this.snapshotAccumulator > 250) {
      this.snapshotAccumulator = 0;
      this.dispatchSnapshot();
    }
  }

  private createMap() {
    this.map = Array.from({ length: MAP_HEIGHT }, (_, y) =>
      Array.from({ length: MAP_WIDTH }, (_, x): TileKind => {
        if (y >= 17 && x < 9) return 'water';
        if (y === 4 || x === 14 || (x >= 3 && x <= 7 && y >= 4 && y <= 6)) return 'path';
        if (
          x >= PLOT_START_X &&
          x < PLOT_START_X + PLOT_COLS &&
          y >= PLOT_START_Y &&
          y < PLOT_START_Y + PLOT_ROWS
        ) {
          const plot = createPlot(x, y);
          this.plots.set(plotKey(x, y), plot);
          return 'plot';
        }
        return 'grass';
      }),
    );
  }

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
    this.add.image(4.5 * TILE_SIZE, 2.7 * TILE_SIZE, 'farmhouse').setDepth(4).setDisplaySize(150, 150);
    this.add.image(4.5 * TILE_SIZE, 3.5 * TILE_SIZE, 'shadow-soft').setDepth(3).setScale(3.2, 2.4).setAlpha(0.85);
    this.houseGlow = this.add.image(4.5 * TILE_SIZE, 2.9 * TILE_SIZE, 'glow').setDepth(6).setScale(2.6).setAlpha(0);
    this.chimneyX = 4.5 * TILE_SIZE + 49;
    this.chimneyY = 2.7 * TILE_SIZE - 50;
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
    this.market = this.add.image(23.6 * TILE_SIZE, 5.8 * TILE_SIZE, 'market-ribbon').setDepth(8).setScale(1.1);

    const well = this.add.container(22 * TILE_SIZE, 8 * TILE_SIZE).setDepth(9);
    well.add(this.add.rectangle(0, 8, 48, 20, 0x6e5846).setStrokeStyle(2, 0x2e211b));
    well.add(this.add.rectangle(0, -3, 34, 18, 0x93b5bd).setStrokeStyle(2, 0x324b55));
    well.add(this.add.rectangle(0, -16, 54, 7, 0x7b4328));
  }

  private createCharacters() {
    this.playerShadow = this.add.image(15.5 * TILE_SIZE, 15.5 * TILE_SIZE + 16, 'shadow').setDepth(49);
    this.rowanShadow = this.add.image(22 * TILE_SIZE, 7.2 * TILE_SIZE + 16, 'shadow').setDepth(39);
    // LPC walkcycles fall back to procedural single frames when sheets are missing.
    const playerFrames = this.textures.exists('player-sheet');
    const rowanFrames = this.textures.exists('rowan-sheet');
    this.player = this.add
      .sprite(15.5 * TILE_SIZE, 15.5 * TILE_SIZE, playerFrames ? 'player-sheet' : 'player', playerFrames ? WALK_ROW.down * 9 : undefined)
      .setDepth(50)
      .setScale(playerFrames ? 0.62 : 1.2);
    this.rowan = this.add
      .sprite(22 * TILE_SIZE, 7.2 * TILE_SIZE, rowanFrames ? 'rowan-sheet' : 'rowan', rowanFrames ? WALK_ROW.down * 9 : undefined)
      .setDepth(40)
      .setScale(rowanFrames ? 0.6 : 1.15);
    if (playerFrames) {
      (['up', 'left', 'down', 'right'] as Direction[]).forEach((dir) => {
        const row = WALK_ROW[dir];
        const key = `player-walk-${dir}`;
        if (!this.anims.exists(key)) {
          this.anims.create({ key, frames: this.anims.generateFrameNumbers('player-sheet', { start: row * 9 + 1, end: row * 9 + 8 }), frameRate: 10, repeat: -1 });
        }
      });
    }
    this.questIcon = this.add.image(22 * TILE_SIZE, 6.45 * TILE_SIZE, 'quest-star').setDepth(45);
    this.tweens.add({ targets: this.questIcon, y: this.questIcon.y - 6, yoyo: true, repeat: -1, duration: 900, ease: 'Sine.inOut' });
    this.cursor = this.add.image(15 * TILE_SIZE + 16, 14 * TILE_SIZE + 16, 'tile-cursor').setDepth(80).setAlpha(0.88);
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
        .image(200 + i * 220, 200 + (i * 130) % 240, 'butterfly')
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
    this.vignetteTop = this.add.rectangle(GAME_WIDTH / 2, 8, GAME_WIDTH, 16, 0x000000, 0.22).setDepth(96);
    this.vignetteBottom = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT - 8, GAME_WIDTH, 16, 0x000000, 0.25).setDepth(96);
  }

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

  private handleMovement(delta: number, _time = 0) {
    if (!this.keys) return;
    const left = this.keys.left.isDown || this.keys.arrowLeft.isDown;
    const right = this.keys.right.isDown || this.keys.arrowRight.isDown;
    const up = this.keys.up.isDown || this.keys.arrowUp.isDown;
    const down = this.keys.down.isDown || this.keys.arrowDown.isDown;
    const dx = (right ? 1 : 0) - (left ? 1 : 0);
    const dy = (down ? 1 : 0) - (up ? 1 : 0);

    if (dx === 0 && dy === 0) {
      if (this.anims.exists(`player-walk-${this.facing}`)) {
        this.player.anims.stop();
        this.player.setFrame(WALK_ROW[this.facing] * 9);
      }
      return;
    }

    if (Math.abs(dx) > Math.abs(dy)) this.facing = dx > 0 ? 'right' : 'left';
    else if (dy !== 0) this.facing = dy > 0 ? 'down' : 'up';

    const length = Math.hypot(dx, dy) || 1;
    const nextX = Phaser.Math.Clamp(this.player.x + (dx / length) * PLAYER_SPEED * (delta / 1000), 12, GAME_WIDTH - 12);
    const nextY = Phaser.Math.Clamp(this.player.y + (dy / length) * PLAYER_SPEED * (delta / 1000), 18, GAME_HEIGHT - 66);

    if (this.isWalkable(nextX, this.player.y)) this.player.x = nextX;
    if (this.isWalkable(this.player.x, nextY)) this.player.y = nextY;
    this.player.setDepth(Math.floor(this.player.y / TILE_SIZE) + 40);
    this.playerShadow.setPosition(this.player.x, this.player.y + 16);
    const walkKey = `player-walk-${this.facing}`;
    if (this.anims.exists(walkKey)) this.player.anims.play(walkKey, true);
    else this.player.setAngle(Math.sin(_time / 130) * 1.5);
    // dust puffs throttled
    this.dustTimer += delta;
    if (this.dustTimer > 220) {
      this.dustTimer = 0;
      const dust = this.add.image(this.player.x + Phaser.Math.Between(-6, 6), this.player.y + 13, 'dust').setDepth(48).setScale(0.7).setAlpha(0.7);
      this.tweens.add({ targets: dust, y: dust.y - 8, alpha: 0, scale: 1.1, duration: 420, onComplete: () => dust.destroy() });
    }
  }

  private handleToolHotkeys() {
    if (!this.keys) return;
    const hotkeys = [this.keys.one, this.keys.two, this.keys.three, this.keys.four, this.keys.five];
    hotkeys.forEach((key, index) => {
      if (Phaser.Input.Keyboard.JustDown(key)) {
        this.selectedToolIndex = index;
        this.prompt = `${TOOL_LABELS[this.selectedTool]} equipped.`;
        this.refreshUi();
      }
    });

    if (Phaser.Input.Keyboard.JustDown(this.keys.q)) {
      this.selectedSeedIndex = (this.selectedSeedIndex + 1) % SEED_ORDER.length;
      this.prompt = `${CROP_DEFINITIONS[this.selectedSeed].label} seeds selected.`;
      this.refreshUi();
    }
  }

  private handleInteractions() {
    if (!this.keys) return;
    if (!Phaser.Input.Keyboard.JustDown(this.keys.space) && !Phaser.Input.Keyboard.JustDown(this.keys.enter)) return;

    if (Phaser.Math.Distance.Between(this.player.x, this.player.y, this.rowan.x, this.rowan.y) < 58) {
      const reward = claimQuestReward(this.quest, this.inventory);
      this.quest = reward.quest;
      this.inventory = reward.inventory;
      this.prompt = reward.message;
      this.refreshUi();
      this.dispatchSnapshot();
      return;
    }

    if (Phaser.Math.Distance.Between(this.player.x, this.player.y, this.market.x, this.market.y) < 58) {
      const sale = sellAllCrops(this.inventory);
      this.inventory = sale.inventory;
      this.prompt = sale.message;
      this.refreshUi();
      this.dispatchSnapshot();
      return;
    }

    const target = this.targetTile();
    const plot = this.plots.get(plotKey(target.x, target.y));
    const action = TOOL_ACTIONS[this.selectedTool];
    if (!plot || !action) {
      this.prompt = this.describeTile(target.x, target.y);
      this.refreshUi();
      return;
    }

    const result = applyFarmAction(plot, this.inventory, action, this.selectedSeed);
    this.plots.set(plotKey(target.x, target.y), result.plot);
    this.inventory = result.inventory;
    if (result.harvestedCrop) this.quest = recordHarvest(this.quest, result.harvestedCrop);
    this.prompt = result.message;
    this.refreshPlot(target.x, target.y);
    this.refreshUi();
    this.dispatchSnapshot();
  }

  private advanceClock(delta: number) {
    this.timeAccumulator += delta;
    if (this.timeAccumulator < 1200) return;
    this.timeAccumulator = 0;
    const next = advanceTime(this.timeState, 10);
    if (next.newDay) this.startNewDay();
    else this.timeState = next.time;
    this.refreshUi();
  }

  private startNewDay() {
    const yesterdayRainy = isRainy(this.weather);
    this.plots.forEach((plot, key) => {
      const nextPlot = advancePlotDay(plot, yesterdayRainy);
      this.plots.set(key, nextPlot);
      this.refreshPlot(nextPlot.x, nextPlot.y);
    });

    this.timeState = createTimeState(this.timeState.day + 1);
    this.season = seasonForDay(this.timeState.day);
    this.weather = weatherForDay(this.timeState.day);
    this.inventory = refillWater(this.inventory);
    this.prompt = this.weather === 'Drizzle' ? 'Morning rain drums softly on the fields.' : 'A new day begins at Amberfall Farm.';
    this.updateWeatherPresentation();
  }

  private updateAtmosphere(delta: number) {
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
    const fireflyNight = this.weather === 'Firefly Shower' || this.timeState.hour >= 19 || this.timeState.hour < 6;
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
    const hour = this.timeState.hour + this.timeState.minute / 60;
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
    const showB = this.weather !== 'Drizzle' && hour >= 8 && hour < 18;
    this.butterflies.forEach((b) => b.setVisible(showB));

    const rainy = this.weather === 'Drizzle';
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
    const rainy = this.weather === 'Drizzle';
    const fireflyWeather = this.weather === 'Firefly Shower';
    this.rainDrops.forEach((drop) => drop.setAlpha(rainy ? 0.72 : 0));
    this.fireflies.forEach((fly) => fly.setAlpha(fireflyWeather ? 0.85 : 0));
    this.cameras.main.setBackgroundColor(
      this.weather === 'Drizzle' ? '#203142' : this.weather === 'Firefly Shower' ? '#1c2636' : '#1a2d1c',
    );
  }

  private refreshPlot(x: number, y: number) {
    const key = plotKey(x, y);
    const plot = this.plots.get(key);
    const base = this.plotSprites.get(key);
    if (!plot || !base) return;

    base.setTexture(plot.wateredToday ? 'plot-watered' : plot.stage === 'wild' ? 'plot-wild' : 'plot-tilled');

    const existing = this.cropSprites.get(key);
    existing?.destroy();
    this.cropSprites.delete(key);
    const oldSparkle = this.sparkles.get(key);
    oldSparkle?.destroy();
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
    const selectedSeed = CROP_DEFINITIONS[this.selectedSeed].label;
    const tools = TOOL_ORDER.map((tool, index) => `${index + 1}${tool === this.selectedTool ? '▶' : ':'}${TOOL_LABELS[tool]}`).join('  ');
    this.toolbarText.setText(`${tools}   Q: ${selectedSeed} seeds`);
    this.promptText.setText(this.contextHint() ?? this.prompt);
    this.clockText.setText(`Day ${this.timeState.day} ${this.formatClock()}\n${this.season}`);
    this.weatherText.setText(`${this.weather}\nQuest ${this.quest.progress}/${this.quest.target}`);
    this.questIcon.setVisible(!this.quest.rewarded);
  }

  private dispatchSnapshot() {
    const snapshot: FarmSnapshot = {
      inventory: this.inventory,
      time: this.timeState,
      season: this.season,
      weather: this.weather,
      quest: this.quest,
      selectedTool: TOOL_LABELS[this.selectedTool],
      selectedSeed: CROP_DEFINITIONS[this.selectedSeed].label,
      prompt: this.contextHint() ?? this.prompt,
      controlsHint: 'Move WASD/Arrows • Tools 1-5 • Seed Q • Space/Enter to act',
    };
    window.dispatchEvent(new CustomEvent('farm-snapshot', { detail: snapshot }));
  }

  private targetTile() {
    const px = worldToTile(this.player.x);
    const py = worldToTile(this.player.y);
    const offsets: Record<Direction, { x: number; y: number }> = {
      up: { x: 0, y: -1 },
      down: { x: 0, y: 1 },
      left: { x: -1, y: 0 },
      right: { x: 1, y: 0 },
    };
    const offset = offsets[this.facing];
    return {
      x: Phaser.Math.Clamp(px + offset.x, 0, MAP_WIDTH - 1),
      y: Phaser.Math.Clamp(py + offset.y, 0, MAP_HEIGHT - 1),
    };
  }

  private updateCursor() {
    const target = this.targetTile();
    const tx = target.x * TILE_SIZE + 16;
    const ty = target.y * TILE_SIZE + 16;
    this.cursor.x = Phaser.Math.Linear(this.cursor.x, tx, 0.35);
    this.cursor.y = Phaser.Math.Linear(this.cursor.y, ty, 0.35);
    this.cursor.setVisible(this.map[target.y][target.x] !== 'water');
    const pulse = 0.82 + Math.sin(this.time.now / 280) * 0.1;
    this.cursor.setAlpha(pulse);
    this.cursor.setAngle(Math.sin(this.time.now / 900) * 2);
  }

  private isWalkable(x: number, y: number) {
    const tileX = worldToTile(x);
    const tileY = worldToTile(y);
    if (tileX < 0 || tileX >= MAP_WIDTH || tileY < 0 || tileY >= MAP_HEIGHT) return false;
    if (this.map[tileY][tileX] === 'water') return false;
    if (tileX >= 2 && tileX <= 7 && tileY >= 1 && tileY <= 4) return false;
    if (Phaser.Math.Distance.Between(x, y, this.rowan.x, this.rowan.y) < 22) return false;
    return true;
  }

  private describeTile(x: number, y: number) {
    const tile = this.map[y][x];
    if (tile === 'water') return 'The pond reflects the sky. Water refills automatically each morning.';
    if (tile === 'plot') return 'Choose a farming tool to work this plot.';
    if (tile === 'path') return 'A packed path leads between the farmhouse, fields, and Rowan.';
    return 'Wild grass waves in the valley breeze.';
  }

  private nearRowanHint() {
    if (Phaser.Math.Distance.Between(this.player.x, this.player.y, this.rowan.x, this.rowan.y) >= 58) return null;
    if (this.quest.rewarded) return 'Rowan: The village market is watching Amberfall now.';
    if (this.quest.completed) return 'Rowan: Those turnips look perfect. Press Space to collect your reward.';
    return `Rowan: Bring me ${this.quest.target - this.quest.progress} more turnip${this.quest.target - this.quest.progress === 1 ? '' : 's'} and I will pay well.`;
  }

  private nearMarketHint() {
    if (Phaser.Math.Distance.Between(this.player.x, this.player.y, this.market.x, this.market.y) >= 58) return null;
    const basket = this.inventory.crops.turnip + this.inventory.crops.strawberry;
    if (basket <= 0) return 'Market stall: harvest crops, then press Space/Enter here to sell your basket.';
    return `Market stall: press Space/Enter to sell ${basket} crop${basket === 1 ? '' : 's'} for coins.`;
  }

  private contextHint() {
    return this.nearRowanHint() ?? this.nearMarketHint();
  }

  private formatClock() {
    const hours = this.timeState.hour;
    const minutes = this.timeState.minute.toString().padStart(2, '0');
    const suffix = hours >= 12 ? 'PM' : 'AM';
    const displayHours = hours % 12 === 0 ? 12 : hours % 12;
    return `${displayHours}:${minutes} ${suffix}`;
  }

  private get selectedTool() {
    return TOOL_ORDER[this.selectedToolIndex];
  }

  private get selectedSeed() {
    return SEED_ORDER[this.selectedSeedIndex];
  }
}
