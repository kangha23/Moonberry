import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App';
import { applyIntent, createFarmState } from './game/state/reducer';
import { farmStore, setBuildKind, setInventoryOpen } from './game/state/store';
import { SEASONS, WEATHERS, seasonLabel, weatherLabel } from './game/systems/time';

/**
 * Two rules, asserted rather than remembered.
 *
 * The first is the older one: the clock, the season, the weather and the
 * satchel were once rendered here *and* in the canvas — the same numbers, in
 * two typefaces, updated by two code paths. Nobody would notice that growing
 * back, because adding a day counter to a React panel is a pleasant
 * afternoon's work and looks like an improvement right up until the two
 * disagree. In-world information lives in the canvas.
 *
 * The second is new: the page is the game. There is no heading, no blurb and
 * no column of settings beside the canvas, because that column is what pushed
 * the hotbar below the fold. What used to be in it is behind Escape.
 */

// The shell under test, not Phaser. A real canvas here would boot a WebGL game
// in jsdom to prove something about a menu.
vi.mock('./components/GameCanvas', () => ({
  default: () => <div data-testid="game-canvas" />,
}));

beforeEach(() => {
  const farm = applyIntent(createFarmState(), { type: 'player/join', playerId: 'a', name: 'A' }).state;
  farmStore.setState({
    farm,
    localPlayerId: 'a',
    sceneReady: true,
    message: 'Thức dậy ở Nông trại Amberfall.',
    inventoryOpen: false,
    menuOpen: false,
    summaryOpen: false,
    buildKind: null,
  });
});

afterEach(cleanup);

const escape = () => fireEvent.keyDown(document, { key: 'Escape' });

describe('the React shell', () => {
  it('renders no clock', () => {
    render(<App />);

    expect(document.body.textContent).not.toMatch(/\d{1,2}:\d{2}\s*(SA|CH)/i);
    expect(document.body.textContent).not.toMatch(/\bNgày \d/);
  });

  it('renders no weather and no season', () => {
    render(<App />);

    const text = document.body.textContent ?? '';
    for (const weather of WEATHERS) expect(text).not.toContain(weatherLabel(weather));
    for (const season of SEASONS) expect(text).not.toContain(seasonLabel(season));
  });

  it('renders no satchel', () => {
    render(<App />);

    // The grid itself is a modal that opens over the canvas, and it is closed.
    expect(screen.queryByRole('dialog', { name: 'Túi đồ' })).toBeNull();
    // What must never come back is a second, always-on copy of its contents.
    expect(screen.queryByText(/ô trống/i)).toBeNull();
    expect(screen.queryByText(/đang mang/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /túi đựng/i })).toBeNull();
  });

  it('renders no energy bar and no quest tracker', () => {
    render(<App />);

    const text = document.body.textContent ?? '';
    expect(text).not.toContain('Vụ thu hoạch đầu tiên');
    // No "137/270" anywhere: a readout of something the canvas already draws
    // is the exact shape the duplication took last time.
    expect(text).not.toMatch(/\d+\s*\/\s*\d+/);
  });

  /**
   * The regression for the bug that started the whole visual pass.
   *
   * A hero panel 270 pixels tall and a settings column beside the canvas are
   * what put the hotbar below the fold on a 1440x900 screen. Nothing may sit
   * around the game except the game.
   */
  it('puts nothing on the page but the canvas', () => {
    render(<App />);

    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.queryByText(/Di chuyển WASD/)).toBeNull();
    expect(screen.getByTestId('game-canvas')).toBeTruthy();
  });

  it('mirrors the game text channel into a live region', () => {
    render(<App />);

    const live = screen.getByRole('status', { name: 'Thông báo trong game' });

    expect(live.textContent).toBe('Thức dậy ở Nông trại Amberfall.');
    expect(live.getAttribute('aria-live')).toBe('polite');
  });

  /** The screen-reader channel has to survive losing the shell around it. */
  it('keeps the live region even with the menu open', () => {
    render(<App />);
    escape();

    expect(screen.getByRole('status', { name: 'Thông báo trong game' })).toBeTruthy();
  });
});

/**
 * Escape, and the three things it means.
 *
 * The order between them is the design, so it is the order that is tested:
 * a footprint on the cursor is dropped before a panel is closed, and a panel
 * is closed before the menu is opened. One case each.
 */
describe('Escape', () => {
  it('cancels a placement first, and leaves the menu shut', () => {
    render(<App />);
    setBuildKind('coop');

    escape();

    expect(farmStore.getState().buildKind).toBeNull();
    expect(farmStore.getState().menuOpen).toBe(false);
    expect(screen.queryByRole('dialog', { name: 'Bảng điều khiển' })).toBeNull();
  });

  it('closes an open panel second, and leaves the menu shut', () => {
    render(<App />);
    setInventoryOpen(true);

    escape();

    expect(farmStore.getState().inventoryOpen).toBe(false);
    expect(farmStore.getState().menuOpen).toBe(false);
  });

  it('opens the menu when nothing else is open', () => {
    render(<App />);

    escape();

    expect(farmStore.getState().menuOpen).toBe(true);
    expect(screen.getByRole('dialog', { name: 'Bảng điều khiển' })).toBeTruthy();
  });

  it('closes the menu again', () => {
    render(<App />);

    escape();
    escape();

    expect(farmStore.getState().menuOpen).toBe(false);
    expect(screen.queryByRole('dialog', { name: 'Bảng điều khiển' })).toBeNull();
  });

  /**
   * A placement armed from the forge survives having the satchel open on top
   * of it, and the first Escape still means "put the barn down".
   */
  it('takes the rungs in order when two things are open at once', () => {
    render(<App />);
    setBuildKind('coop');
    setInventoryOpen(true);

    escape();
    expect(farmStore.getState().buildKind).toBeNull();
    expect(farmStore.getState().inventoryOpen).toBe(true);

    escape();
    expect(farmStore.getState().inventoryOpen).toBe(false);
    expect(farmStore.getState().menuOpen).toBe(false);

    escape();
    expect(farmStore.getState().menuOpen).toBe(true);
  });

  it('does not open the menu over the morning summary', () => {
    render(<App />);
    farmStore.setState({ summaryOpen: true });

    escape();

    expect(farmStore.getState().menuOpen).toBe(false);
  });
});

describe('the menu', () => {
  it('holds what the page used to keep beside the canvas', () => {
    render(<App />);
    escape();

    expect(screen.getByText(/Di chuyển WASD/)).toBeTruthy();
    expect(screen.getByRole('button', { name: /bắt đầu nông trại mới/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /tắt tiếng/i })).toBeTruthy();
    expect(screen.getByRole('button', { name: /toàn màn hình/i })).toBeTruthy();
  });

  it('is a real dialog, and takes focus when it opens', () => {
    render(<App />);
    escape();

    const dialog = screen.getByRole('dialog', { name: 'Bảng điều khiển' });
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(dialog);
  });

  /**
   * Tab must not walk out into the page behind — a page the player cannot see
   * and cannot get back from without a mouse.
   */
  it('keeps Tab inside itself', () => {
    render(<App />);
    escape();

    const dialog = screen.getByRole('dialog', { name: 'Bảng điều khiển' });
    const stops = Array.from(dialog.querySelectorAll('button, input, [tabindex="0"]'));
    expect(stops.length).toBeGreaterThan(1);

    for (let i = 0; i < stops.length + 2; i += 1) {
      fireEvent.keyDown(document, { key: 'Tab' });
      expect(dialog.contains(document.activeElement)).toBe(true);
    }
  });

  it('hands focus back to the canvas when it closes', () => {
    render(<App />);
    const frame = screen.getByTestId('game-canvas');
    frame.setAttribute('tabindex', '-1');
    frame.focus();

    escape();
    expect(document.activeElement).not.toBe(frame);

    escape();
    expect(document.activeElement).toBe(frame);
  });
});
