import { expect, test, type Page } from '@playwright/test'

/** Holds a key down for a while, the way a player leaning on it would. */
async function walk(page: Page, key: string, ms: number) {
  await page.keyboard.down(key)
  await page.waitForTimeout(ms)
  await page.keyboard.up(key)
}

/**
 * The prompt bar, as the page mirrors it for a screen reader.
 *
 * The clock, the hotbar and the village are drawn in the canvas and nowhere
 * else, so this live region is the only thing the game says that the DOM can
 * read — which makes it the right thing to test against, and the same thing a
 * player using a screen reader is relying on.
 */
function announced(page: Page) {
  return page.locator('.prompt-live')
}

/** What the prompt says when somebody is standing within arm's reach. */
const SOMEBODY = /Space\/Enter để (trò chuyện|tặng)|đã nhận quà rồi|giao nông sản/i

test('the village has people in it, and they answer when spoken to', async ({ page }) => {
  await page.goto('/')
  // `.first()` because React's strict mode mounts the canvas twice on boot
  // and Phaser tears the first one down a beat later.
  await expect(page.locator('canvas').first()).toBeVisible()
  await expect(announced(page)).not.toBeEmpty({ timeout: 15_000 })

  // Players spawn at the south end of the farm and the lane out is on the east
  // side, two thirds of the way up. East along the bottom first, then north up
  // the edge until somebody is in reach — the walk is timed against a frame
  // rate this test does not control, so it checks after every short burst
  // rather than covering a measured distance.
  await walk(page, 'ArrowRight', 7000)

  let met = false
  for (let i = 0; i < 30 && !met; i += 1) {
    await walk(page, 'ArrowUp', 200)
    await walk(page, 'ArrowRight', 200)
    met = SOMEBODY.test((await announced(page).textContent()) ?? '')
  }

  expect(met, 'walked into the village and found nobody to talk to').toBe(true)

  // Held briefly rather than tapped: Phaser clears "just pressed" on key-up,
  // so a press that begins and ends inside one frame is never seen.
  await walk(page, ' ', 140)

  // They answer. What is asserted is the shape of a line — somebody's name,
  // then something in quotes — rather than any one sentence, which would make
  // this test a second copy of the dialogue table.
  await expect(announced(page)).toContainText(/\w+: "/)
})
