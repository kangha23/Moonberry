import { useEffect } from 'react';
import { useStore } from 'zustand';
import ChestPanel from './components/ChestPanel';
import GameCanvas from './components/GameCanvas';
import InventoryScreen from './components/InventoryScreen';
import MenuScreen from './components/MenuScreen';
import RanchPanel from './components/RanchPanel';
import ShopPanel from './components/ShopPanel';
import WorkshopPanel from './components/WorkshopPanel';
import { promptFor } from './game/state/selectors';
import { farmStore, pressEscape } from './game/state/store';

/**
 * The page around the game, which is now no page at all.
 *
 * It used to be a product landing page with a game embedded in it: a title, a
 * blurb, and a column of settings beside the canvas. On a 1440x900 screen the
 * heading took the top 270 pixels and the hotbar fell below the fold — a
 * player had to scroll to see what was in their hand. That was a bug, not a
 * layout choice.
 *
 * So the page is the canvas. Everything that column held — the mixer, the
 * invite code, starting over — is behind Escape now, in `MenuScreen`.
 *
 * The dividing line that survives all of this is the one from the HUD spec:
 * in-world information — the clock, the season, the weather, the hotbar,
 * energy, the quest — is drawn in the canvas and only in the canvas. What is
 * left here is the frame, the panels that are documents rather than pictures,
 * and the live region that reads the game out loud.
 */
export default function App() {
  const prompt = useStore(farmStore, promptFor);
  const sceneReady = useStore(farmStore, (store) => store.sceneReady);

  /**
   * Escape, read in one place.
   *
   * It means three things depending on what is open, and the order between
   * them is a decision: a placement is cancelled before a panel is closed, and
   * a panel is closed before the menu is opened. That order lives in the store
   * so it is the same order whichever panel happens to be mounted — it used to
   * be spread across the scene and three components, each claiming the key for
   * itself, and adding a fourth claimant to that is how a ladder ends up with
   * its rungs in a different order depending on what is on screen.
   *
   * Capturing, so it runs before anything else that might be listening.
   */
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      pressEscape();
    };
    globalThis.addEventListener('keydown', onKey, true);
    return () => globalThis.removeEventListener('keydown', onKey, true);
  }, []);

  return (
    <main className="stage">
      <GameCanvas />
      <InventoryScreen />
      <ShopPanel />
      <WorkshopPanel />
      <RanchPanel />
      <ChestPanel />
      <MenuScreen />

      {/*
        The prompt bar, mirrored for a screen reader.

        The bar along the bottom of the canvas is pixels; this is the same
        words as text, so somebody who cannot see the farm is still told that
        the turnip came up, that the satchel is full, and that Rowan is waiting
        for three more. Not a second HUD: it says what the game just said, and
        a polite live region only speaks when that changes.

        Empty until the scene is up, so the first thing the game says arrives
        as a change and is announced rather than sitting there unread.

        It is the only thing on this page that is not the canvas, and it must
        stay that way: taking the React shell away and leaving this behind
        would have been a silent way to make the game unplayable without sight.
      */}
      <p className="sr-only prompt-live" role="status" aria-live="polite" aria-label="Thông báo trong game">
        {sceneReady ? prompt : ''}
      </p>
    </main>
  );
}
