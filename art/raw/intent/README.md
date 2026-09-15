# art/raw/intent/

These nine PNGs are the pre-migration soil plot tiles — `plot-tilled`, `plot-watered`,
`plot-wild`, and their `-2`/`-3` variants. They are **not imported art**. They hold the colours the
procedural plot generator (`scripts/generate-plot-art.mjs`) was designed around before the palette
existed, kept here for one reason only: so those colours get a vote when `scripts/derive-palette.mjs`
derives `art/palette.json`.

## Why this folder exists

`art/raw/` deliberately excludes `plot-*.png` — see Task 2's brief — because the procedural
generator and the palette derivation are two producers of the same output path, and letting both
write there at once was the collision that ruling was made to stop. That exclusion was correct for
that problem, but it had a side effect nobody caught until the soil ramp came out wrong: the plot
tiles are the single largest ground surface in the game, and with them absent, the palette had no
idea what colour soil actually needs to be. The result was a soil ramp built entirely from
incidental brown pixels elsewhere in the art (crate edges, character outlines, a few sprite shadows)
that never agreed with each other on hue.

Putting the *pixels* back in front of the derivation without putting the *files* back in
`art/raw/lpc/` resolves both problems at once:

- `histogram()` in `scripts/derive-palette.mjs` walks `art/raw/` recursively for `.png` files, so it
  descends into this folder and these colours are counted like any other.
- `scripts/apply-palette.mjs` reads `art/raw/lpc/` only (`IN_DIR = path.join('art', 'raw', 'lpc')`) —
  it never lists this directory, so nothing here is ever quantised, re-encoded, or written to
  `public/assets/lpc/`. These files stay exactly as they are, forever.

## Rules for this folder

- Only add files here that exist to cast a colour vote, not to be imported or shipped as art.
- Never point `apply-palette.mjs`, or any importer, at this folder. If that ever needs to change,
  it means the reason this folder exists has changed too, and that decision belongs in a plan, not
  a one-line fix.
- Do not edit these PNGs to "improve" them. Their value is in being the original intent the
  generator was built against — editing them to chase a palette result would defeat the point of
  letting the art vote on the palette rather than the other way around.
