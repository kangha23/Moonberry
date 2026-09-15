import { expect, test } from '@playwright/test'

/**
 * The trees have to stay whole.
 *
 * Phaser 4 does not reliably draw a rotated sprite. Measured at twenty-four
 * frames a run, a tree swaying by 1.4 degrees came back torn into wedges in
 * half of them, with the background showing through; the same tree with the
 * rotation removed was identical to the pixel in all twenty-four. Size,
 * origin, `roundPixels` on the game and on the camera, whether the camera was
 * easing, and Phaser 4.2.1 were each held and varied, and only the rotation
 * mattered. So the wind sway is a one-pixel slide now, and this is the test
 * that says so.
 *
 * It counts pixels whose colour belongs to `tree.png` and to no grass tile —
 * canopy, in other words — across the whole canvas. That is deliberately not a
 * fixed rectangle: an earlier version clipped one patch of field and went
 * green the day the suite ran in parallel, the player covered slightly less
 * ground under load, and the tree simply was not in the rectangle any more. A
 * whole tree contributes the same count every frame; a torn one loses
 * thousands of them, wherever it happens to be standing.
 */
const FRAMES = 20

/** Every colour in one image, as "r,g,b", ignoring anything transparent. */
const COLLECT_COLOURS = `(url) => new Promise((resolve, reject) => {
  const img = new Image();
  img.onerror = () => reject(new Error('could not load ' + url));
  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const { data } = ctx.getImageData(0, 0, img.width, img.height);
    const seen = new Set();
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 200) seen.add(data[i] + ',' + data[i + 1] + ',' + data[i + 2]);
    }
    resolve([...seen]);
  };
  img.src = url;
})`

test('a swaying tree is drawn whole in every frame', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.goto('/')
  await expect(page.locator('canvas').first()).toBeVisible()
  await expect(page.locator('.prompt-live')).not.toBeEmpty({ timeout: 20_000 })
  await page.waitForTimeout(2000)
  // Dismiss the morning panel: one Escape opens the menu, the next closes it.
  await page.keyboard.press('Escape')
  await page.waitForTimeout(300)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(500)

  // The canopy's own palette, minus anything the ground is painted in too, so
  // the count is trees rather than scenery.
  const canopy = await page.evaluate(async (collect) => {
    const read = eval(`(${collect})`) as (url: string) => Promise<string[]>
    const tree = await read('/assets/lpc/tree.png')
    const grass = new Set(await read('/assets/lpc/tile-grass.png'))
    return tree.filter((colour) => !grass.has(colour))
  }, COLLECT_COLOURS)
  expect(canopy.length).toBeGreaterThan(4)

  // East, to bring a tree on screen. How far it gets does not matter: the
  // count below does not care where the tree is, only that one is in shot.
  for (const key of ['KeyD', 'KeyD', 'KeyD']) {
    await page.keyboard.down(key)
    await page.waitForTimeout(900)
    await page.keyboard.up(key)
  }
  await page.waitForTimeout(2000)

  const counts: number[] = []
  for (let i = 0; i < FRAMES; i += 1) {
    const shot = await page.screenshot()
    counts.push(
      await page.evaluate(
        ([dataUrl, colours]) =>
          new Promise<number>((resolve) => {
            const wanted = new Set(colours as string[])
            const img = new Image()
            img.onload = () => {
              const canvas = document.createElement('canvas')
              canvas.width = img.width
              canvas.height = img.height
              const ctx = canvas.getContext('2d')!
              ctx.drawImage(img, 0, 0)
              const { data } = ctx.getImageData(0, 0, img.width, img.height)
              let hits = 0
              for (let at = 0; at < data.length; at += 4) {
                if (wanted.has(`${data[at]},${data[at + 1]},${data[at + 2]}`)) hits += 1
              }
              resolve(hits)
            }
            img.src = dataUrl as string
          }),
        [`data:image/png;base64,${shot.toString('base64')}`, canopy] as const,
      ),
    )
    await page.waitForTimeout(100)
  }

  const most = Math.max(...counts)
  const least = Math.min(...counts)
  // A tree has to be on screen at all, or this passes by photographing grass —
  // which is the failure it exists to catch, wearing a success for a hat.
  expect(most, `no tree on screen: ${counts.join(', ')}`).toBeGreaterThan(3000)
  // Whole versus torn is a factor of four, so a loose bound is the right one:
  // it will never fire on another GPU's rounding.
  expect(least, `the tree came apart in some frames: ${counts.join(', ')}`).toBeGreaterThan(most * 0.8)
})
