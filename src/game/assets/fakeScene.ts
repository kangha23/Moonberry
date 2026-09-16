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
  scene: never;
}

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

  const scene = {
    textures: {
      exists: (key: string) => existing.includes(key) || keys.includes(key),
      get: (key: string) => ({
        getSourceImage: () => {
          sampled.push(key);
          return { width: 32, height: 32 };
        },
      }),
      createCanvas: (key: string) => {
        keys.push(key);
        return { getContext: () => ctx(), refresh: () => undefined };
      },
    },
  };

  return {
    keys,
    sampled,
    get drawImageCalls() {
      return state.drawImageCalls;
    },
    scene: scene as never,
  };
}
