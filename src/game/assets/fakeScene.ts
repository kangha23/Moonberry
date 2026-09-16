/**
 * Enough of a Phaser scene to run `createPixelArtTextures` in a test.
 *
 * jsdom has no 2D canvas context, so there is no real drawing to inspect. What
 * there is, and what the tests here care about, is the shape of the
 * conversation: which texture keys get built, and which existing textures get
 * read while building them.
 */
export interface FakeScene {
  keys: string[];
  /** Texture keys whose source image was read, e.g. by the fringe builder. */
  sampled: string[];
  drawImageCalls: number;
  scene: Phaser.Scene;
}

/**
 * The three `TextureManager` methods this fake stands in for, typed against
 * Phaser's own signatures rather than cast away with `never`.
 *
 * `never` let this drift from `Phaser.Scene` with nothing to notice: `never`
 * is assignable to anything, so `scene as never` type-checked no matter what
 * shape `scene` actually had, and a renamed or re-signatured method on the
 * real `TextureManager` would never be compared against this file. Typing the
 * piece that is actually implemented, against `Pick<Phaser.Textures.
 * TextureManager, ...>`, makes `tsc` check `exists`/`get`/`createCanvas`
 * here against Phaser's real declarations.
 *
 * The cast to `Phaser.Scene` at the bottom of this file is still there and
 * still necessary — nothing this small can structurally satisfy the rest of
 * that class, and `createPixelArtTextures` needs a real one — but everything
 * upstream of that one cast is now checked.
 */
type FakeTextureManager = Pick<Phaser.Textures.TextureManager, 'exists' | 'get' | 'createCanvas'>;

export function fakeScene(existing: string[] = []): FakeScene {
  const keys: string[] = [];
  const sampled: string[] = [];
  const state = { drawImageCalls: 0 };

  const ctx = (): unknown =>
    new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'canvas') return { width: 1, height: 1 };
          if (prop === 'drawImage') {
            return () => {
              state.drawImageCalls += 1;
            };
          }
          return () => ctx();
        },
        set: () => true,
      },
    );

  const textures: FakeTextureManager = {
    exists: (key) => existing.includes(key) || keys.includes(key),
    get: (key) =>
      ({
        getSourceImage: () => {
          sampled.push(String(key));
          return { width: 32, height: 32 };
        },
      }) as unknown as Phaser.Textures.Texture,
    createCanvas: (key) => {
      keys.push(key);
      return {
        getContext: () => ctx(),
        refresh: () => undefined,
      } as unknown as Phaser.Textures.CanvasTexture;
    },
  };

  return {
    keys,
    sampled,
    get drawImageCalls() {
      return state.drawImageCalls;
    },
    scene: { textures } as unknown as Phaser.Scene,
  };
}
