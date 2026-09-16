/**
 * The dialogue box: what a villager says, with their face beside it.
 *
 * The reducer chooses the line and the mood and says so in an event; this
 * holds the words up, types them out, pages them when they are long, and
 * waits for a key. The prompt bar still gets the line too, because it is the
 * fallback channel and a screen reader is reading it — this is the main one.
 */
import type Phaser from 'phaser';
import { PALETTE } from '../../assets/palette.generated';
import { LPC_PORTRAITS } from '../../assets/lpc.generated';
import { npcDef, type NpcId } from '../../npcs/definitions';
import { PORTRAIT_MOODS, type PortraitMood } from '../../npcs/types';
import type { HudLayout } from '../../ui/hudLayout';
import { DIALOGUE, dialogueLayout, paginate, typedText, type DialogueLayout } from '../../ui/dialogueLayout';
import type { ScreenLayer } from './screen';
import { DEPTH, PROSE_FONT } from './shared';

/** The body text. Nunito, because a line of dialogue is a sentence. */
const BODY_SIZE = 18;
const BODY_LINE_SPACING = 6;

/**
 * How long a page has to have been up before a press can close it.
 *
 * The press that finished typing a page and the press that closes it are two
 * presses, but a player tapping the key to skip the typing can land both in a
 * quarter of a second and never read the end of the line.
 */
const PAGE_SETTLE_MS = 180;

export class DialogueBox {
  private panel!: Phaser.GameObjects.Container;
  private textFrame!: Phaser.GameObjects.NineSlice;
  private sideFrame!: Phaser.GameObjects.NineSlice;
  private portrait!: Phaser.GameObjects.Image;
  private nameFrame!: Phaser.GameObjects.NineSlice;
  private nameText!: Phaser.GameObjects.Text;
  private body!: Phaser.GameObjects.Text;
  private more!: Phaser.GameObjects.Text;

  private placed: DialogueLayout | null = null;
  private line = '';
  private pages: string[] = [''];
  private page = 0;
  private pageShownAt = 0;
  /** Set when the whole page is on screen, whether typed or skipped to. */
  private pageDoneAt: number | null = null;
  private advanceRequested = false;

  private readonly scene: Phaser.Scene;
  private readonly screen: ScreenLayer;

  constructor(scene: Phaser.Scene, screen: ScreenLayer) {
    this.scene = scene;
    this.screen = screen;
  }

  get isOpen(): boolean {
    return this.panel?.visible ?? false;
  }

  create() {
    this.textFrame = this.screen.frame('panel', 0, 0, 100, 100);
    this.sideFrame = this.screen.frame('panel', 0, 0, 100, 100);
    this.nameFrame = this.screen.frame('plate', 0, 0, 100, DIALOGUE.nameHeight);
    this.portrait = this.scene.add.image(0, 0, '__MISSING').setOrigin(0, 0).setVisible(false);
    this.nameText = this.screen.pixelText(0, 0, 22).setOrigin(0.5, 0.5);
    this.body = this.scene.add.text(0, 0, '', {
      fontFamily: PROSE_FONT,
      fontSize: `${BODY_SIZE}px`,
      color: PALETTE['light.7'],
      lineSpacing: BODY_LINE_SPACING,
    });
    // Said with a glyph rather than words: "press a key" is what every box in
    // the genre has taught a player this triangle means.
    this.more = this.screen.pixelText(0, 0, 20).setColor(PALETTE['light.5']).setOrigin(1, 1).setText('▼');
    this.scene.tweens.add({
      targets: this.more,
      y: '+=3',
      yoyo: true,
      repeat: -1,
      duration: 420,
      ease: 'Sine.inOut',
    });

    this.panel = this.scene.add
      .container(0, 0, [
        this.textFrame,
        this.sideFrame,
        this.portrait,
        this.nameFrame,
        this.nameText,
        this.body,
        this.more,
      ])
      .setDepth(DEPTH.modal)
      .setVisible(false);
    this.screen.add(this.panel);
  }

  layout(hud: HudLayout) {
    const placed = dialogueLayout(hud);
    this.placed = placed;
    const { text, side, portrait, name } = placed;

    this.textFrame.setPosition(text.x, text.y).setSize(text.width, text.height);
    this.sideFrame.setPosition(side.x, side.y).setSize(side.width, side.height);
    this.portrait.setPosition(portrait.x, portrait.y).setScale(portrait.scale);
    this.nameFrame.setPosition(name.x, name.y).setSize(name.width, name.height);
    this.nameText.setPosition(name.x + name.width / 2, name.y + name.height / 2);
    this.body.setPosition(text.x + DIALOGUE.pad + 6, text.y + DIALOGUE.pad + 4);
    this.body.setWordWrapWidth(text.width - DIALOGUE.pad * 2 - 12, true);
    this.more.setPosition(text.x + text.width - DIALOGUE.pad - 4, text.y + text.height - DIALOGUE.pad);

    // A resize mid-conversation re-wraps the line rather than leaving it
    // spilling out of a box that just got narrower.
    if (this.isOpen) this.repaginate(this.scene.time.now);
  }

  /**
   * Holds up a line.
   *
   * A second line while one is already up replaces it rather than queueing
   * behind it: the player pressed the key again, and what they asked for is
   * whatever the villager says now.
   */
  open(npc: NpcId, line: string, mood: PortraitMood, now: number) {
    this.line = line;
    this.nameText.setText(npcDef(npc).name);
    this.setFace(npc, mood);
    this.panel.setVisible(true);
    this.advanceRequested = false;
    this.repaginate(now);
  }

  close() {
    this.panel.setVisible(false);
    this.advanceRequested = false;
  }

  /** A press arrived. Acted on in `update`, so it lands on a frame. */
  requestAdvance() {
    if (this.isOpen) this.advanceRequested = true;
  }

  /**
   * Types the page on, and answers a press.
   *
   * A press while the page is still typing finishes it; a press on a finished
   * page turns it, or closes the box on the last one. Returns true on the frame
   * the box closed, so the scene can make sure the key that closed it does not
   * go on to swing a tool.
   */
  update(now: number): boolean {
    if (!this.isOpen) return false;

    const page = this.pages[this.page];
    if (this.pageDoneAt === null) {
      const typed = typedText(page, now - this.pageShownAt);
      this.body.setText(typed);
      if (typed === page) this.pageDoneAt = now;
    }
    this.more.setVisible(this.pageDoneAt !== null);

    if (!this.advanceRequested) return false;
    this.advanceRequested = false;

    if (this.pageDoneAt === null) {
      this.body.setText(page);
      this.pageDoneAt = now;
      return false;
    }
    if (now - this.pageDoneAt < PAGE_SETTLE_MS) return false;
    if (this.page < this.pages.length - 1) {
      this.showPage(this.page + 1, now);
      return false;
    }
    this.close();
    return true;
  }

  /**
   * The face, from the sheet's frame for this mood.
   *
   * A villager with no portrait gets an empty board rather than borrowing
   * somebody else's face — a wrong face is a bug a player notices, and an
   * absent one is a gap they do not.
   */
  private setFace(npc: NpcId, mood: PortraitMood) {
    const key = `portrait-${npc}`;
    const drawn = LPC_PORTRAITS.includes(npc) && this.scene.textures.exists(key);
    this.portrait.setVisible(drawn);
    if (drawn) this.portrait.setTexture(key, PORTRAIT_MOODS.indexOf(mood));
  }

  /** Splits the line into pages that fit the board as it is laid out now. */
  private repaginate(now: number) {
    const text = this.placed?.text;
    if (!text) return;
    const lineHeight = BODY_SIZE * 1.35 + BODY_LINE_SPACING;
    const perPage = Math.floor((text.height - DIALOGUE.pad * 2 - 8) / lineHeight);
    this.pages = paginate(this.body.getWrappedText(this.line), perPage);
    this.showPage(0, now);
  }

  private showPage(index: number, now: number) {
    this.page = index;
    this.pageShownAt = now;
    this.pageDoneAt = null;
    this.body.setText('');
    this.more.setVisible(false);
  }
}
