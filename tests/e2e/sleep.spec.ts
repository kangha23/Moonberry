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
 * The clock, the weather and the satchel are drawn in the canvas now and
 * nowhere else, so this live region is the only thing the game says that the
 * DOM can read — which makes it the right thing to test against, and the same
 * thing a player using a screen reader is relying on.
 */
function announced(page: Page) {
  return page.locator('.prompt-live')
}

/**
 * Waits until the scene is actually running before sending it anything.
 *
 * Phaser learns a key is held from the keydown event, so a key pressed while
 * the game is still loading is a key it never hears about. The live region
 * stays empty until the scene has finished starting up.
 */
async function waitForGameRunning(page: Page) {
  await expect(announced(page)).not.toBeEmpty({ timeout: 15_000 })
}

test('walking to the farmhouse and turning in starts the next day', async ({ page }) => {
  await page.goto('/')
  // `.first()` because React's strict mode mounts the canvas twice on boot
  // and Phaser tears the first one down a beat later.
  await expect(page.locator('canvas').first()).toBeVisible()
  await waitForGameRunning(page)

  // Up the lane to the farmhouse. Since spec 10 the farm is overgrown and a
  // rock is solid, so leaning on one direction and hoping is no longer a route
  // — this shuffles sideways every few bursts to get round whatever came up
  // overnight, and stops the moment the house is in reach.
  const atTheDoor = async () => /đi ngủ/i.test((await announced(page).textContent()) ?? '')

  // Five seconds is twenty tiles at the walking pace, which clears the thirty
  // rows of farm with room to spare and leans on the top edge once it arrives.
  // Kept tight on purpose: the whole test runs against a thirty-second budget,
  // and under a parallel suite a Phaser game does not get the frame rate it
  // would alone.
  await walk(page, 'ArrowUp', 5000)
  for (let i = 0; i < 24 && !(await atTheDoor()); i += 1) {
    await walk(page, 'ArrowLeft', 250)
    if (i % 3 === 2) await walk(page, i % 6 === 2 ? 'ArrowUp' : 'ArrowDown', 200)
  }

  expect(await announced(page).textContent()).toMatch(/đi ngủ/i)

  // Held briefly rather than tapped: Phaser clears "just pressed" on key-up,
  // so a press that begins and ends inside one frame is never seen.
  await walk(page, 'b', 120)

  // One player alone is the whole vote, so the night rolls over immediately
  // and the morning summary goes up, holding the keyboard until it has been on
  // screen long enough to have been read. Wait it out, then dismiss it.
  await page.waitForTimeout(900)
  await page.keyboard.press('Escape')

  // Standing at the bed, the prompt is about the bed, so step away from it:
  // what the prompt falls back to is the last thing the game said, which is
  // the morning announcing itself. The farmhouse footprint is 160px tall with
  // a 58px interact radius, so from the north edge this needs ~270px south —
  // well over a second at 132px/s — to leave its range.
  await walk(page, 'ArrowDown', 2000)
  await expect(announced(page)).toContainText('Ngày 2 bắt đầu')
})

test('the satchel opens over the canvas and takes the keyboard with it', async ({ page }) => {
  await page.goto('/')
  // `.first()` because React's strict mode mounts the canvas twice on boot
  // and Phaser tears the first one down a beat later.
  await expect(page.locator('canvas').first()).toBeVisible()
  await waitForGameRunning(page)

  const grid = page.getByRole('dialog', { name: 'Túi đồ' })
  await expect(grid).toBeHidden()

  // Held briefly rather than tapped, for the same reason as the B key above.
  await walk(page, 'i', 120)
  await expect(grid).toBeVisible()

  // The starting tools are in reach, in the order the hotbar shows them. Six
  // of them since spec 10 — the axe, the pickaxe and the scythe are handed
  // over on the first morning rather than sold — so the seeds start at slot 7.
  await expect(grid.getByRole('button', { name: /Ô 1: Cuốc/ })).toBeVisible()
  await expect(grid.getByRole('button', { name: /Ô 2: Bình tưới, còn 12/ })).toBeVisible()
  await expect(grid.getByRole('button', { name: /Ô 4: Rìu/ })).toBeVisible()
  await expect(
    grid.getByRole('button', { name: /Ô 7: Hạt củ cải x8, giá 6g ngoài sạp/ }),
  ).toBeVisible()

  // Input is suspended while it is open. A swing that leaked through would put
  // a new action message in the live region, so unchanged text is the proof.
  const before = await announced(page).textContent()
  await walk(page, 'ArrowUp', 300)
  await walk(page, ' ', 300)
  await expect(grid).toBeVisible()
  expect(await announced(page).textContent()).toBe(before)

  // Tab stays inside. It is a dialog over a game that has stood down, so focus
  // walking out of it lands on a page the player cannot see and cannot get
  // back from without a mouse.
  for (let i = 0; i < 5; i += 1) await page.keyboard.press('Tab')
  await expect(grid.locator(':focus')).toHaveCount(1)

  await page.keyboard.press('Escape')
  await expect(grid).toBeHidden()
})
