import { expect, test, type Page } from '@playwright/test'
import { hudLayout } from '../../src/game/ui/hudLayout'

/**
 * An ordinary laptop window.
 *
 * It used to have to be 1800 tall, because the page put a title and a blurb
 * above the canvas and `page.mouse` works in viewport coordinates without
 * scrolling. There is no page above the canvas any more: the canvas is the
 * window, and the window can be a normal size.
 */
test.use({ viewport: { width: 1280, height: 800 } })

/** The prompt bar, mirrored into the DOM for a screen reader. */
function announced(page: Page) {
  return page.locator('.prompt-live')
}

/**
 * Where the canvas is on the page, in CSS pixels.
 *
 * Clicks are given in page coordinates and the canvas is scaled to fit its
 * frame, so it is never its design size. Phaser's input system accounts for
 * that; this test deliberately goes through a real click rather than doing the
 * arithmetic itself, because doing the arithmetic is the bug.
 */
async function stage(page: Page) {
  await expect(announced(page)).not.toBeEmpty({ timeout: 15_000 })
  // React's strict mode mounts the game twice on boot, and Phaser tears the
  // first canvas down a beat later. Clicks go to a canvas rather than to the
  // store, so one sent during that window lands on the game being destroyed.
  await expect.poll(() => page.locator('canvas').count(), { timeout: 15_000 }).toBe(1)

  const box = await page.locator('canvas').boundingBox()
  if (!box) throw new Error('the canvas has no box')
  return box
}

/**
 * Clicks a point given as a fraction of the canvas, and answers with what the
 * game said about it.
 *
 * Every click in this file is safe to repeat — selecting the same slot again,
 * or being told the same tile is still too far — which is what lets the
 * assertions below retry rather than depend on the surviving game having
 * finished loading by the time the first click goes out.
 */
async function clickAndRead(page: Page, box: { x: number; y: number; width: number; height: number }, fx: number, fy: number) {
  await page.mouse.click(box.x + box.width * fx, box.y + box.height * fy)
  await page.waitForTimeout(250)
  return (await announced(page).textContent()) ?? ''
}

test('the mouse aims, and reach is the server’s rule', async ({ page }) => {
  await page.goto('/')
  const box = await stage(page)

  // Two points a long way apart, both clear of the HUD. The camera clamps at
  // the edges of the map, so where the farmhand is on screen is not something
  // this test can know — but they cannot be standing within a tile and a half
  // of both of these, so at least one click is a click across the fence.
  //
  // Perfectly well-formed clicks, refused because of where the player is
  // standing — and refused by the reducer the server runs, not by the cursor.
  //
  // Only the refusal is asserted. That a click on a tile in reach farms *that*
  // tile needs to know where the farmhand is on screen, which this test
  // cannot; it is pinned down exactly in the reducer and server tests instead.
  await expect
    .poll(
      async () => {
        const near = await clickAndRead(page, box, 0.12, 0.14)
        const far = await clickAndRead(page, box, 0.88, 0.78)
        return /ngoài tầm với/i.test(near) || /ngoài tầm với/i.test(far)
      },
      { timeout: 20_000 },
    )
    .toBe(true)
})

test('clicking the hotbar changes what is in hand, and does not swing it', async ({ page }) => {
  await page.goto('/')
  const box = await stage(page)

  // The hotbar is drawn inside the canvas, so a press on it is a press on the
  // world unless the hit test runs first. Where it is is no longer a fixed
  // design coordinate — the canvas is the window — so the test asks the same
  // pure function the scene lays the bar out with.
  //
  // Picking up the watering can is announced; tilling the ground under the
  // hotbar would have been announced instead, and that is the bug this guards.
  const { hotbar } = hudLayout(box.width, box.height)
  const slotTwo = (hotbar.x + (hotbar.cell + hotbar.gap) + hotbar.cell / 2) / box.width
  await expect
    .poll(() => clickAndRead(page, box, slotTwo, hotbar.y / box.height), { timeout: 20_000 })
    .toContain('Đang cầm bình tưới')
})
