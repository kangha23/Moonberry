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

/**
 * Moves the saved player onto the farmhouse doorstep, and reloads into it.
 *
 * Walking there from the spawn point by holding keys cannot line up with a
 * doorway one tile wide: key timing depends on a frame rate this test does not
 * control. So the save the game wrote is edited instead, in an init script
 * that runs before the game on the next load — early enough that nothing can
 * autosave the old position back over it.
 */
async function reloadOnTheDoorstep(page: Page) {
  // The first save waits for the first clock step plus the autosave debounce,
  // which is two seconds on an idle machine and more than the default five
  // when every worker is booting its own copy of the game at once.
  await expect
    .poll(() => page.evaluate(() => localStorage.getItem('moonberry:farm') !== null), { timeout: 15_000 })
    .toBe(true)
  await page.addInitScript(() => {
    if (sessionStorage.getItem('doorstep')) return
    sessionStorage.setItem('doorstep', 'done')
    const save = JSON.parse(localStorage.getItem('moonberry:farm') ?? 'null')
    const player = save?.farm?.players?.local
    if (!player) return
    // The ring road in front of the house: column 5, row 7, facing the door.
    Object.assign(player, { area: 'farm', x: 5 * 32 + 16, y: 7 * 32 + 16, facing: 'up' })
    localStorage.setItem('moonberry:farm', JSON.stringify(save))
  })
  await page.reload()
  await expect(page.locator('canvas').first()).toBeVisible()
  await waitForGameRunning(page)
}

test('going indoors, turning in, and waking up still indoors', async ({ page }) => {
  await page.goto('/')
  // `.first()` because React's strict mode mounts the canvas twice on boot
  // and Phaser tears the first one down a beat later.
  await expect(page.locator('canvas').first()).toBeVisible()
  await waitForGameRunning(page)
  await reloadOnTheDoorstep(page)

  // Up the step and through the door.
  await walk(page, 'ArrowUp', 400)
  await expect(announced(page)).toContainText('ngôi nhà')

  // To the bed, with the room's own walls as the guide rather than a stopwatch:
  // left along the clear row inside the door until the west wall stops it, then
  // up that wall until the foot of the bed stops it. Both walks are longer
  // than they need to be, and leaning on a wall costs nothing.
  const atTheBed = async () => /đi ngủ/i.test((await announced(page).textContent()) ?? '')
  await walk(page, 'ArrowLeft', 2000)
  await walk(page, 'ArrowUp', 1500)
  await expect.poll(atTheBed).toBe(true)

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
  // the morning announcing itself.
  await walk(page, 'ArrowDown', 1000)
  await expect(announced(page)).toContainText('Ngày 2 bắt đầu')

  // And the morning happened indoors. The bed is only in the farmhouse, so
  // walking back up to it and being offered it again is the proof.
  await walk(page, 'ArrowUp', 1500)
  await expect.poll(atTheBed).toBe(true)
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
