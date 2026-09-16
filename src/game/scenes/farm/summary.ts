/**
 * The morning panel, and the tally of yesterday it reports.
 *
 * The scene counts what happened as the events arrive and says when a new day
 * has started; this keeps the counts, turns them into rows with pictures, and
 * holds the card up until somebody presses a key.
 */
import type Phaser from 'phaser';
import { PALETTE, tint } from '../../assets/palette.generated';
import type { GameEvent } from '../../state/intents';
import { itemDef } from '../../systems/items';
import { seasonLabel } from '../../systems/time';
import type { ScreenLayer } from './screen';
import { DEPTH, WILT_TINT } from './shared';

/** One line of the morning summary: a picture, and what it is a picture of. */
interface SummaryRow {
  texture: string;
  text: string;
  tint?: number;
}

/**
 * The morning panel.
 *
 * Six rows, and six is the honest limit rather than an arbitrary one: a day
 * that did seven notable things has a seventh worth cutting, and a panel that
 * grows until it runs off the bottom of a short window is worse than one that
 * stops.
 */
const SUMMARY = {
  width: 460,
  /** The tallest it ever gets, which is what the card is first built at. */
  height: 300,
  /** Above the first row: the frame, and the greeting set at 26px. */
  head: 86,
  /** Below the last: the frame again, and the line telling you to press a key. */
  foot: 52,
  rowHeight: 34,
  icon: 32,
  maxRows: 6,
} as const;

/** The card that greets the morning, and yesterday's numbers behind it. */
export class MorningSummary {
  summaryPanel!: Phaser.GameObjects.Container;
  private summaryCard!: Phaser.GameObjects.NineSlice;
  private summaryTitle!: Phaser.GameObjects.Text;
  private summaryHint!: Phaser.GameObjects.Text;
  private summaryRows: Array<{ icon: Phaser.GameObjects.Image; text: Phaser.GameObjects.Text }> = [];
  /** What the farm did today, tallied from events for the morning summary. */
  today = { coins: 0, harvested: 0, collected: 0, cleared: 0, fished: 0 };
  /**
   * What came up while nobody was looking, held for the morning panel.
   *
   * Stashed rather than shown as it arrives, like the withered crops and the
   * hungry animals: it lands in the same frame as `dayStarted`, and a farm
   * quietly going back to scrub is news that belongs in the summary rather
   * than flashing past on the prompt bar.
   */
  grewOvernight: Extract<GameEvent, { kind: 'nodesGrew' }> | null = null;
  /**
   * What finished overnight, held until the morning panel can report it.
   *
   * The whole point of this spec is that each day ends more capable than it
   * began, and the morning summary is where a player finds out that it did.
   */
  finishedOvernight: SummaryRow[] = [];
  /** Set by a `collapsed` event so the next morning can explain the missing gold. */
  collapsedFor = 0;
  /**
   * How many animals went to bed hungry, for the morning panel.
   *
   * Stashed rather than shown as it arrives, like the withered crops: the
   * event lands in the same frame as `dayStarted`, and this is news that
   * belongs in the summary rather than flashing past on the prompt bar.
   */
  hungryOvernight = 0;
  summaryShownAt = 0;
  dismissRequested = false;
  /** Last night's losses, held until the morning panel can report them. */
  witheredOvernight: Extract<GameEvent, { kind: 'cropsWithered' }> | null = null;

  private readonly scene: Phaser.Scene;
  private readonly screen: ScreenLayer;

  constructor(scene: Phaser.Scene, screen: ScreenLayer) {
    this.scene = scene;
    this.screen = screen;
  }

  /** Keeps the card in the middle of a canvas of this size. */
  layout(width: number, height: number) {
    this.summaryPanel.setPosition(width / 2, height / 2);
  }

  /**
   * The morning panel: what yesterday came to, and why the wallet is lighter
   * if it is. A silent loss of money reads as a bug.
   *
   * A row is a picture and a short phrase rather than a paragraph. The house
   * style says feeling is shown rather than told and that the prompt bar is
   * the fallback channel rather than the main one — and "0 luống đã lớn lên
   * qua đêm" was a sentence doing a sprout's job.
   */
  showDaySummary(day: number, grown: number) {
    const rows: SummaryRow[] = [
      { texture: 'icon-coin', text: `${this.today.coins}g kiếm được hôm qua` },
      { texture: 'item-basket', text: `${this.today.harvested} nông sản đã thu` },
      { texture: 'crop-sprout', text: `${grown} luống lớn lên qua đêm` },
    ];

    // The herd, but only when it did something: a farm with no animals should
    // not be told every morning that nought eggs were collected.
    if (this.today.collected > 0) {
      rows.push({ texture: 'item-egg', text: `${this.today.collected} món từ chuồng` });
    }
    // Yesterday evening on the bank, on the same terms as the coop: only when
    // there was one.
    if (this.today.fished > 0) {
      rows.push({ texture: 'item-carp', text: `${this.today.fished} mẻ câu được` });
    }
    if (this.hungryOvernight > 0) {
      rows.push({
        texture: 'animal-hungry',
        text: `${this.hungryOvernight} con vật đói qua đêm — kho cỏ cạn rồi`,
        tint: tint('building.3'),
      });
    }

    // What the land did without you. Only when it did something, so a farm
    // that is entirely cleared is not told every morning that nothing grew.
    const grew = this.grewOvernight;
    if (grew && grew.spawned > 0) {
      rows.push({ texture: 'node-weed', text: `${grew.spawned} thứ mọc lên qua đêm` });
    }
    if (grew && grew.cleared > 0) {
      rows.push({
        texture: 'node-grass',
        text: `Mùa mới dọn sạch ${grew.cleared} đám ngoài đồng`,
        tint: WILT_TINT,
      });
    }
    if (this.today.cleared > 0) {
      rows.push({ texture: 'item-wood', text: `${this.today.cleared} thứ đã dọn hôm qua` });
    }

    if (this.collapsedFor > 0) {
      rows.push({
        texture: 'icon-energy-bolt',
        text: `Gục lúc 2 giờ sáng — mất ${this.collapsedFor}g`,
        tint: tint('building.3'),
      });
    }

    // The ratchet, reported. A farm that is better than it was yesterday
    // should say so on the morning it becomes true.
    rows.push(...this.finishedOvernight);

    // Named, not counted, and pictured: "6 crops withered" is the line that
    // reads as a bug, where three greyed-out crop icons read as a season
    // ending. The tint is the same grey the doomed plants wore in the field.
    const withered = this.witheredOvernight;
    if (withered) {
      const names = withered.crops.map((crop) => itemDef(crop).label.toLowerCase());
      const list =
        names.length === 1
          ? names[0]
          : `${names.slice(0, -1).join(', ')} và ${names[names.length - 1]}`;
      rows.push({
        texture: itemDef(withered.crops[0]).texture,
        text: `Mùa ${seasonLabel(withered.season)} lấy đi ${withered.count} luống: ${list}`,
        tint: WILT_TINT,
      });
    }

    this.drawSummary(`Chào buổi sáng — Ngày ${day}`, rows.slice(0, SUMMARY.maxRows));
    this.summaryPanel.setVisible(true);
    this.summaryShownAt = this.scene.time.now;
    this.dismissRequested = false;
    this.today = { coins: 0, harvested: 0, collected: 0, cleared: 0, fished: 0 };
    this.collapsedFor = 0;
    this.hungryOvernight = 0;
    this.witheredOvernight = null;
    this.grewOvernight = null;
    this.finishedOvernight = [];
  }

  /**
   * The morning panel, with pictures.
   *
   * It used to be a paragraph: "Ngày 5 bắt đầu. 0 luống đã lớn lên qua đêm."
   * The house style says feeling is shown rather than narrated and the prompt
   * bar is the fallback channel, not the main one — and a sentence about how
   * many beds grew overnight is narration where a row of sprouts would do.
   *
   * So the rows are built here and the pictures come from the same item
   * textures the hotbar and the satchel draw: the turnip the frost took is the
   * turnip you were carrying.
   */
  createSummaryPanel() {
    this.summaryCard = this.screen.frame('panel', 0, 0, SUMMARY.width, SUMMARY.height);
    this.summaryTitle = this.screen.pixelText(0, 0, 26).setOrigin(0.5, 0);
    this.summaryRows = [];
    for (let i = 0; i < SUMMARY.maxRows; i += 1) {
      // Every icon is drawn at the same size whatever its source is, so a
      // 16px coin and a 32px sprout sit in one column rather than in two.
      const icon = this.scene.add
        .image(0, 0, 'icon-coin')
        .setDisplaySize(SUMMARY.icon, SUMMARY.icon)
        .setVisible(false);
      const text = this.screen.pixelText(0, 0, 18).setOrigin(0, 0.5).setVisible(false);
      this.summaryRows.push({ icon, text });
    }
    this.summaryHint = this.screen.pixelText(0, 0, 16, PALETTE['light.7']).setOrigin(0.5, 0);
    this.summaryHint.setText('Nhấn phím bất kỳ');

    this.summaryPanel = this.scene.add
      .container(0, 0, [
        this.summaryCard,
        this.summaryTitle,
        ...this.summaryRows.flatMap((row) => [row.icon, row.text]),
        this.summaryHint,
      ])
      .setDepth(DEPTH.modal + 1)
      .setVisible(false);
    this.screen.add(this.summaryPanel);
  }

  /**
   * Fills the morning panel's rows, and shrinks it to the day it is reporting.
   *
   * A fixed-height card with three lines in it and a hand's width of empty
   * board underneath reads as a panel with something missing from it. The card
   * is as tall as the morning was eventful.
   */
  private drawSummary(title: string, rows: SummaryRow[]) {
    const height = SUMMARY.head + rows.length * SUMMARY.rowHeight + SUMMARY.foot;
    const top = -height / 2;

    this.summaryCard.setPosition(-SUMMARY.width / 2, top).setSize(SUMMARY.width, height);
    this.summaryTitle.setPosition(0, top + 18).setText(title);
    this.summaryHint.setPosition(0, top + height - 34);

    this.summaryRows.forEach((slot, index) => {
      const row = rows[index];
      slot.icon.setVisible(Boolean(row));
      slot.text.setVisible(Boolean(row));
      if (!row) return;

      const y = top + SUMMARY.head + index * SUMMARY.rowHeight - SUMMARY.rowHeight / 2;
      if (this.scene.textures.exists(row.texture)) slot.icon.setTexture(row.texture);
      // Fitted inside the icon's square rather than stretched to it: a silo is
      // twice as tall as it is wide, and squashed square it is a barrel.
      const frame = slot.icon.frame;
      const fit = SUMMARY.icon / Math.max(frame.width, frame.height, 1);
      slot.icon.setDisplaySize(frame.width * fit, frame.height * fit);
      slot.icon.setPosition(-SUMMARY.width / 2 + 44, y);
      slot.icon.setTint(row.tint ?? 0xffffff);
      slot.text.setPosition(-SUMMARY.width / 2 + 72, y).setText(row.text);
    });
  }
}
