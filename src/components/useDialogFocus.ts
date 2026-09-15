import { useEffect, type RefObject } from 'react';

/**
 * Makes a panel behave like a dialog rather than look like one.
 *
 * Two things, and both of them are what a sighted mouse user never notices
 * and a keyboard user cannot play without:
 *
 * Focus moves into the panel when it opens and goes back where it came from
 * when it closes. Without the first, a screen reader announces nothing and
 * Escape has landed nowhere; without the second, focus falls to the document
 * body and Tab starts the page over from the top.
 *
 * And Tab stays inside. Without the trap, Tab walks out of the panel and into
 * whatever is behind it — which the player cannot see, cannot get back from
 * without a mouse, and which is taking no input anyway because the scene has
 * stood down while the panel is up.
 *
 * Escape is deliberately not handled here. It means three different things
 * depending on what is open, and that order is decided once, in the store.
 */
export function useDialogFocus(open: boolean, panel: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    if (!open) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Tab' || !panel.current) return;

      const stops = Array.from(
        panel.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex="0"]',
        ),
      );
      if (stops.length === 0) return;

      // Always handled here, never by the browser: the panel itself holds
      // focus when it opens, and that is not one of the stops, so leaving the
      // default behaviour in place would step straight out of the dialog.
      event.preventDefault();
      const here = stops.indexOf(document.activeElement as HTMLElement);
      const step = event.shiftKey ? -1 : 1;
      const next = here === -1 ? (event.shiftKey ? stops.length - 1 : 0) : here + step;
      stops[(next + stops.length) % stops.length].focus();
    };

    globalThis.addEventListener('keydown', onKey);
    return () => globalThis.removeEventListener('keydown', onKey);
  }, [open, panel]);

  useEffect(() => {
    if (!open) return;
    const cameFrom = document.activeElement as HTMLElement | null;
    panel.current?.focus();

    return () => {
      // Back where it came from — unless it came from nowhere, which is the
      // usual case: a panel opened with a keystroke while the player was just
      // playing, and nothing on the page held focus. Handing it back to the
      // body would leave the next Tab starting the page over from the top, so
      // it goes to the game instead, which is what the player is looking at.
      if (cameFrom && cameFrom !== document.body && cameFrom.isConnected) {
        cameFrom.focus();
        return;
      }
      document.querySelector<HTMLElement>('.game-frame')?.focus();
    };
  }, [open, panel]);
}
