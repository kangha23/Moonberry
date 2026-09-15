import { expect, test } from '@playwright/test'

test('loads the playable Amberfall Farm vertical slice', async ({ page }) => {
  await page.goto('/')

  // The page is the game now: no heading, no blurb, no column of settings.
  // What used to be beside the canvas is behind Escape, and what the game has
  // to say reaches the DOM through one live region.
  await expect(page.getByLabel('Khung hình trò chơi nông trại')).toBeVisible()
  // `.first()` because React's strict mode mounts the canvas twice on boot
  // and Phaser tears the first one down a beat later.
  await expect(page.locator('canvas').first()).toBeVisible()
  await expect(page.locator('.prompt-live')).not.toBeEmpty({ timeout: 15_000 })

  await expect(page.getByRole('heading')).toHaveCount(0)

  await page.keyboard.press('Escape')
  await expect(page.getByText(/Di chuyển WASD/)).toBeVisible()
})
