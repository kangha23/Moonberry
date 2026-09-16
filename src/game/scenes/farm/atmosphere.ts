/**
 * The weather and the time of day, as they are drawn.
 *
 * Rain, fireflies, petals, butterflies and cloud shadows on the glass; dusk
 * and dawn washed over the screen; and the few things in the world that move
 * with the clock rather than with the state — the water, the chimney smoke,
 * the lit windows and the fire in the hearth. Under a roof most of it is
 * switched off, which is decided here every frame.
 */
import Phaser from 'phaser';
import { PALETTE } from '../../assets/palette.generated';
import { areaMap, mineDepth } from '../../world/areas';
import type { AreaView } from './area';
import type { Hud } from './hud';
import type { ScreenLayer } from './screen';
import { DEPTH, type SceneContext } from './shared';

/** The sky over the built area, and everything in the area that answers to it. */
export class AtmosphereView {
  private rainDrops: Phaser.GameObjects.Image[] = [];
  private fireflies: Phaser.GameObjects.Image[] = [];
  private clouds: Phaser.GameObjects.Image[] = [];
  private petals: Phaser.GameObjects.Image[] = [];
  private butterflies: Phaser.GameObjects.Image[] = [];
  private smokeTimer = 0;
  private waterTimer = 0;
  private waterFrame = 0;
  lastWeather = '';

  private readonly context: Pick<SceneContext, 'scene' | 'farm' | 'builtArea' | 'areaLayer'>;
  private readonly scene: Phaser.Scene;
  private readonly screen: ScreenLayer;
  /** The size of the glass, and the dusk and sunset washes the HUD built over it. */
  private readonly hud: Pick<Hud, 'layout' | 'dayNightOverlay' | 'sunsetOverlay'>;
  /** The water, the chimney and the lights the area was built with. */
  private readonly area: Pick<AreaView, 'waterSprites' | 'chimney' | 'houseGlow' | 'hearthGlow' | 'hearthFire'>;

  constructor(
    context: Pick<SceneContext, 'scene' | 'farm' | 'builtArea' | 'areaLayer'>,
    screen: ScreenLayer,
    hud: Pick<Hud, 'layout' | 'dayNightOverlay' | 'sunsetOverlay'>,
    area: Pick<AreaView, 'waterSprites' | 'chimney' | 'houseGlow' | 'hearthGlow' | 'hearthFire'>,
  ) {
    this.context = context;
    this.scene = context.scene;
    this.screen = screen;
    this.hud = hud;
    this.area = area;
  }

  /**
   * The weather, which is drawn on the glass rather than in the world.
   *
   * Rain, fireflies, petals and cloud shadows are pinned to the screen, so
   * they belong to the screen layer and have to be re-scattered whenever it
   * changes size. Their drifts are tweens, and a tween remembers the numbers
   * it was built with, so this kills and rebuilds them rather than trying to
   * move a target mid-flight.
   */
  spreadAtmosphere() {
    const { width, height } = this.hud.layout;

    this.rainDrops.forEach((drop, i) => drop.setPosition((i * 73) % width, (i * 43) % height));

    this.fireflies.forEach((firefly, i) => {
      this.scene.tweens.killTweensOf(firefly);
      firefly.setPosition((i * 131) % width, height * 0.12 + ((i * 47) % Math.max(60, height * 0.7)));
      this.scene.tweens.add({
        targets: firefly,
        x: firefly.x + 16,
        y: firefly.y - 12,
        yoyo: true,
        repeat: -1,
        duration: 1200 + i * 35,
        ease: 'Sine.inOut',
      });
    });

    this.clouds.forEach((cloud, i) => {
      cloud.setPosition((i * 317) % width, height * 0.06 + ((i * 97) % Math.max(40, height * 0.32)));
    });

    this.petals.forEach((petal, i) => petal.setPosition((i * 173) % width, (i * 89) % height));

    this.butterflies.forEach((butterfly, i) => {
      this.scene.tweens.killTweensOf(butterfly);
      butterfly.setPosition(
        Math.min(width - 40, 200 + i * 220),
        Math.min(height - 120, 200 + ((i * 130) % 240)),
      );
      this.scene.tweens.add({
        targets: butterfly,
        x: butterfly.x + 42,
        y: butterfly.y - 26,
        yoyo: true,
        repeat: -1,
        duration: 2600 + i * 700,
        ease: 'Sine.inOut',
      });
      this.scene.tweens.add({
        targets: butterfly,
        scaleX: 0.6,
        yoyo: true,
        repeat: -1,
        duration: 180,
        ease: 'Sine.inOut',
      });
    });
  }

  createWeatherSprites() {
    for (let i = 0; i < 58; i += 1) {
      const drop = this.scene.add.image(0, 0, 'rain-drop').setDepth(DEPTH.weather).setAlpha(0);
      this.screen.add(drop);
      this.rainDrops.push(drop);
    }

    for (let i = 0; i < 20; i += 1) {
      const firefly = this.scene.add.image(0, 0, 'firefly').setDepth(DEPTH.weather + 1).setAlpha(0);
      this.screen.add(firefly);
      this.fireflies.push(firefly);
    }
  }

  createAmbient() {
    for (let i = 0; i < 4; i += 1) {
      const cloud = this.scene.add
        .image(0, 0, 'cloud-shadow')
        .setDepth(DEPTH.weather - 2)
        .setAlpha(0.8)
        .setScale(1 + (i % 3) * 0.4);
      this.screen.add(cloud);
      this.clouds.push(cloud);
    }
    for (let i = 0; i < 14; i += 1) {
      const petal = this.scene.add
        .image(0, 0, i % 3 === 0 ? 'petal' : 'firefly')
        .setDepth(DEPTH.weather + 2)
        .setAlpha(i % 3 === 0 ? 0.85 : 0);
      petal.setData('seed', i * 1.7);
      petal.setData('isPetal', i % 3 === 0);
      this.screen.add(petal);
      this.petals.push(petal);
    }
    for (let i = 0; i < 3; i += 1) {
      const butterfly = this.scene.add.image(0, 0, 'butterfly').setDepth(DEPTH.weather + 3).setScale(1.2);
      this.screen.add(butterfly);
      this.butterflies.push(butterfly);
    }
  }

  updateAtmosphere(delta: number) {
    const farm = this.context.farm;
    const time = this.scene.time.now / 1000;
    // Under a roof there is no sky: no dusk, no night, no rain, nothing flying
    // past. Everything that belongs to the weather is switched off here rather
    // than when the area is built, because the clock keeps turning it back on.
    const indoor = this.context.builtArea !== null && areaMap(this.context.builtArea).indoor;

    this.waterTimer += delta;
    if (this.waterTimer > 380 && this.scene.textures.exists('tile-water-2') && this.scene.textures.exists('tile-water-3')) {
      this.waterTimer = 0;
      this.waterFrame = (this.waterFrame + 1) % 3;
      const key = this.waterFrame === 0 ? 'tile-water' : this.waterFrame === 1 ? 'tile-water-2' : 'tile-water-3';
      this.area.waterSprites.forEach((sprite) => sprite.setTexture(key));
    }
    this.area.waterSprites.forEach((sprite, i) => {
      sprite.setAlpha(0.96 + Math.sin(time * 2 + i * 0.7) * 0.04);
    });

    this.clouds.forEach((cloud, i) => {
      cloud.setVisible(!indoor);
      cloud.x += delta * 0.008 * (1 + (i % 3) * 0.4);
      if (cloud.x > this.hud.layout.width + 100) cloud.x = -100;
    });

    // Hours past this morning's midnight, so 1am reads as 25 and the night
    // keeps getting darker instead of brightening back into dawn.
    const hour = farm.time.totalMinutes / 60;
    const fireflyNight = farm.weather === 'Firefly Shower' || hour >= 19 || hour < 6;
    this.petals.forEach((petal) => {
      petal.setVisible(!indoor);
      const seed = Number(petal.getData('seed') ?? 0);
      const isPetal = Boolean(petal.getData('isPetal'));
      petal.y += delta * 0.012;
      petal.x += Math.sin(time * 1.2 + seed) * delta * 0.01;
      petal.setAngle(Math.sin(time + seed) * 18);
      if (petal.y > this.hud.layout.height + 12) {
        petal.y = -12;
        petal.x = (seed * 137) % this.hud.layout.width;
      }
      if (!isPetal) petal.setAlpha(fireflyNight ? 0.7 + Math.sin(time * 3 + seed) * 0.25 : 0);
    });

    if (this.area.chimney) {
      this.smokeTimer += delta;
      if (this.smokeTimer > 900) {
        this.smokeTimer = 0;
        const smoke = this.scene.add
          .image(this.area.chimney.x + Phaser.Math.Between(-2, 2), this.area.chimney.y, 'smoke')
          .setDepth(7)
          .setScale(0.5)
          .setAlpha(0.6);
        this.context.areaLayer?.add(smoke);
        this.scene.tweens.add({
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

    const eveningAlpha = Phaser.Math.Clamp((hour - 18) / 4, 0, 0.42);
    const dawnAlpha = Phaser.Math.Clamp((7 - hour) / 2, 0, 0.18);
    this.hud.dayNightOverlay.setAlpha(indoor ? 0 : Math.max(eveningAlpha, dawnAlpha));
    const sunset = hour >= 16.5 && hour <= 19 ? Math.sin(((hour - 16.5) / 2.5) * Math.PI) * 0.16 : 0;
    this.hud.sunsetOverlay.setAlpha(indoor ? 0 : sunset);

    if (this.area.houseGlow) {
      const nightGlow = hour >= 18 || hour < 6.5 ? 0.75 : hour >= 17 ? 0.35 : 0;
      this.area.houseGlow.setAlpha(nightGlow + Math.sin(time * 2.2) * 0.05);
    }

    if (this.area.hearthGlow) {
      // Brighter once it is dark outside, when it is the room's only light.
      // Two sines at unrelated rates, so the flicker never settles into a beat.
      const base = hour >= 18 || hour < 6.5 ? 0.72 : 0.5;
      this.area.hearthGlow.setAlpha(base + Math.sin(time * 7.3) * 0.06 + Math.sin(time * 12.1) * 0.04);
    }
    // A frame every seventh of a second or so, off the clock rather than a
    // timer, so a rebuilt room picks the flicker up mid-stride.
    this.area.hearthFire?.setTexture(`hearth-fire-${Math.floor(time * 7) % 2}`);

    const showButterflies = !indoor && farm.weather !== 'Drizzle' && hour >= 8 && hour < 18;
    this.butterflies.forEach((b) => b.setVisible(showButterflies));

    const rainy = !indoor && farm.weather === 'Drizzle';
    this.rainDrops.forEach((drop, index) => {
      if (!rainy) return;
      drop.y += delta * (0.28 + (index % 5) * 0.018);
      drop.x += delta * 0.05;
      if (drop.y > this.hud.layout.height + 10) {
        drop.y = -10;
        drop.x = (drop.x + 173) % this.hud.layout.width;
      }
    });
  }

  updateWeatherPresentation() {
    const { weather } = this.context.farm;
    if (weather === this.lastWeather) return;
    this.lastWeather = weather;
    // `buildArea` clears `lastWeather`, so walking through a door lands here
    // and the weather is put away (or brought back) on the step itself.
    const indoor = this.context.builtArea !== null && areaMap(this.context.builtArea).indoor;
    const rainy = !indoor && weather === 'Drizzle';
    const fireflyWeather = !indoor && weather === 'Firefly Shower';
    this.rainDrops.forEach((drop) => drop.setAlpha(rainy ? 0.72 : 0));
    this.fireflies.forEach((fly) => fly.setAlpha(fireflyWeather ? 0.85 : 0));
    // Rainy was the source literal `203142`, whose mechanical nearest is `shadow.2` (d=0.0507)
    // - but firefly weather (the source literal `1c2636`) also lands on `shadow.2` (d=0.0308),
    // and these three backdrops must stay distinct or two different weathers
    // look identical. `shadow.3` (#332f66, H244) is the second-nearest for
    // rainy (d=0.0738) and a closer hue match to its blue (H210) than
    // `shadow.2`'s blue-purple (H286) is, so rainy moves there instead.
    // Underground, past the edge of the rock is more rock: the same dark the
    // floor's overlay is drawn in, not the sky.
    const underground = this.context.builtArea !== null && mineDepth(this.context.builtArea) !== null;
    this.scene.cameras.main.setBackgroundColor(
      underground
        ? PALETTE['outline.2']
        : rainy
          ? PALETTE['shadow.3']
          : fireflyWeather
            ? PALETTE['shadow.2']
            : PALETTE['shadow.1'],
    );
  }
}
