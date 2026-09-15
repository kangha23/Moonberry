import { useEffect, useRef } from 'react';
import Phaser from 'phaser';
import { createGameConfig } from '../game/config';
import { registerGame } from '../game/view/fullscreen';

/**
 * The canvas, and the wait before it.
 *
 * Phaser draws text into the canvas with whatever font the browser has when it
 * draws it, and a Text object only re-renders when its string changes. A label
 * that never changes — the "1" over the first hotbar cell — would therefore be
 * stuck in the fallback face for the whole session if the game booted before
 * VT323 arrived. So the fonts are asked for by name first, and the game starts
 * either when they are ready or when the ask fails.
 *
 * `document.fonts.load` rather than `document.fonts.ready`: the faces are used
 * in the canvas and nowhere in the DOM, so nothing has requested them yet and
 * `ready` would resolve having loaded nothing.
 */
export default function GameCanvas() {
  const hostRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    let cancelled = false;

    const boot = () => {
      if (cancelled || !hostRef.current || gameRef.current) return;
      gameRef.current = new Phaser.Game(createGameConfig(hostRef.current));
      registerGame(gameRef.current);
    };

    const fonts = document.fonts;
    if (fonts) {
      void Promise.all([fonts.load('16px VT323'), fonts.load('16px Nunito')])
        .catch(() => undefined)
        .then(boot);
    } else {
      boot();
    }

    return () => {
      cancelled = true;
      registerGame(null);
      gameRef.current?.destroy(true);
      gameRef.current = null;
    };
  }, []);

  return (
    // Focusable, so the Escape menu has somewhere to hand focus back to when
    // it closes. Without it focus lands on the document body and the next Tab
    // starts the page over from the top.
    <div
      ref={hostRef}
      className="game-frame"
      tabIndex={-1}
      aria-label="Khung hình trò chơi nông trại"
    />
  );
}
