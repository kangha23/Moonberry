import { expect, test, type Page } from '@playwright/test'
import { hudLayout } from '../../src/game/ui/hudLayout'

/**
 * The framing, end to end.
 *
 * Most of this spec is a matter for eyes and cannot be asserted. These are the
 * parts that can: the page is the game, the game is the size of the window,
 * the hotbar is on screen at a laptop resolution, and Escape does the three
 * things it is supposed to do in the order it is supposed to do them.
 */

/** The prompt bar, mirrored into the DOM for a screen reader. */
function announced(page: Page) {
  return page.locator('.prompt-live')
}

/** Waits for one canvas, alive and talking, and answers with where it is. */
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

/** The centre of one hotbar cell, in page coordinates. */
function cellAt(box: { x: number; y: number; width: number; height: number }, slot: number) {
  const { hotbar } = hudLayout(box.width, box.height)
  return {
    x: box.x + hotbar.x + slot * (hotbar.cell + hotbar.gap) + hotbar.cell / 2,
    y: box.y + hotbar.y,
  }
}

/**
 * The bug this whole spec was written for.
 *
 * At 1366x768 the page used to put 270 pixels of heading above a canvas fixed
 * at 640 tall, so the hotbar sat below the fold: a player had to scroll the
 * page to see what was in their hand. Asserted two ways — the document does
 * not scroll at all, and a click on slot 2 reaches the game.
 */
test('the hotbar is on screen at 1366x768, with nothing to scroll', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto('/')
  const box = await stage(page)

  const scroll = await page.evaluate(() => ({
    x: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    y: document.documentElement.scrollHeight - document.documentElement.clientHeight,
  }))
  expect(scroll.x).toBeLessThanOrEqual(0)
  expect(scroll.y).toBeLessThanOrEqual(0)

  // And the canvas is the window, rather than a panel somewhere down it.
  expect(box.width).toBeCloseTo(1366, 0)
  expect(box.height).toBeCloseTo(768, 0)

  // Slot 2 holds the watering can. Picking it up is announced; tilling the
  // ground under the hotbar would have been announced instead.
  const cell = cellAt(box, 1)
  await expect
    .poll(
      async () => {
        await page.mouse.click(cell.x, cell.y)
        await page.waitForTimeout(250)
        return (await announced(page).textContent()) ?? ''
      },
      { timeout: 20_000 },
    )
    .toContain('Đang cầm bình tưới')
})

test('there is no horizontal scrolling at 400px', async ({ page }) => {
  await page.setViewportSize({ width: 400, height: 720 })
  await page.goto('/')
  await stage(page)

  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(0)

  // And with the menu open over it, which is the widest thing on the page.
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Bảng điều khiển' })).toBeVisible()
  const withMenu = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  )
  expect(withMenu).toBeLessThanOrEqual(0)
})

/**
 * Going full screen and coming back is a resize, and so is this.
 *
 * Full screen itself needs a real user gesture and a browser willing to grant
 * it, which a headless run is not reliably either. What it actually exercises
 * is the resize path — the camera zoom and the whole HUD layout are chosen
 * from the size of the canvas — so the round trip is driven directly here,
 * and what is asserted is that nothing stays stuck at the old size.
 */
test('the HUD comes back to the right place after a resize', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 768 })
  await page.goto('/')
  await stage(page)

  await page.setViewportSize({ width: 900, height: 600 })
  await page.waitForTimeout(400)
  const shrunk = await stage(page)
  expect(shrunk.width).toBeCloseTo(900, 0)
  expect(shrunk.height).toBeCloseTo(600, 0)

  await page.setViewportSize({ width: 1366, height: 768 })
  await page.waitForTimeout(400)
  const box = await stage(page)
  expect(box.width).toBeCloseTo(1366, 0)
  expect(box.height).toBeCloseTo(768, 0)

  // The hotbar is where the layout says it is again, and still takes a click.
  const cell = cellAt(box, 2)
  await expect
    .poll(
      async () => {
        await page.mouse.click(cell.x, cell.y)
        await page.waitForTimeout(250)
        return (await announced(page).textContent()) ?? ''
      },
      { timeout: 20_000 },
    )
    .toMatch(/Đang cầm/)
})

test('Escape opens the menu, closes it, and gives the game back its focus', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await stage(page)

  const menu = page.getByRole('dialog', { name: 'Bảng điều khiển' })
  await expect(menu).toBeHidden()

  await page.keyboard.press('Escape')
  await expect(menu).toBeVisible()
  // What the page used to keep in a column beside the canvas.
  await expect(page.getByText(/Di chuyển WASD/)).toBeVisible()
  await expect(page.getByRole('button', { name: /toàn màn hình/i })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(menu).toBeHidden()
  await expect.poll(() => page.evaluate(() => document.activeElement?.className ?? '')).toContain(
    'game-frame',
  )
})

test('the satchel takes Escape before the menu does', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await stage(page)

  // Held briefly rather than tapped: Phaser clears "just pressed" on key-up,
  // so a press that begins and ends inside one frame is never seen — and on
  // a loaded machine a frame is long enough for that to happen.
  await page.keyboard.down('Tab')
  await page.waitForTimeout(150)
  await page.keyboard.up('Tab')
  await expect(page.getByRole('dialog', { name: 'Túi đồ' })).toBeVisible()

  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog', { name: 'Túi đồ' })).toBeHidden()
  await expect(page.getByRole('dialog', { name: 'Bảng điều khiển' })).toBeHidden()
})

test('the screen-reader channel survives losing the page around it', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await stage(page)

  const live = announced(page)
  await expect(live).toHaveAttribute('aria-live', 'polite')
  await expect(live).toHaveAttribute('role', 'status')

  // Held briefly rather than tapped: Phaser clears "just pressed" on key-up,
  // so a press that begins and ends inside one frame is never seen.
  await page.keyboard.down('2')
  await page.waitForTimeout(150)
  await page.keyboard.up('2')

  // The canvas drew that in pixels; this is the same thing in words, and it is
  // the only channel a player using a screen reader has.
  await expect.poll(() => live.textContent(), { timeout: 15_000 }).toContain('Đang cầm bình tưới')
})
