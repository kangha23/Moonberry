/**
 * Who this browser is, and which world it is trying to reach.
 *
 * The token is a long random string the server issues once and recognises
 * afterwards. It is enough to come back to your own satchel on your own
 * machine — and it is not a password. Anyone holding the token is that player,
 * there is nothing to verify it against, and clearing site data loses it.
 * Real accounts are a separate piece of work; see the README.
 */

const TOKEN_KEY = 'moonberry:token';

/** The query parameter that carries an invite code into the page. */
const CODE_PARAM = 'farm';

export function readToken(): string | null {
  try {
    return globalThis.localStorage?.getItem(TOKEN_KEY) ?? null;
  } catch {
    // A private window or blocked storage simply means a new player each visit.
    return null;
  }
}

export function rememberToken(token: string): void {
  try {
    globalThis.localStorage?.setItem(TOKEN_KEY, token);
  } catch {
    // Not fatal: the session still works, it just will not be recognised again.
  }
}

export function forgetToken(): void {
  try {
    globalThis.localStorage?.removeItem(TOKEN_KEY);
  } catch {
    // Nothing to do; the caller only cares that we did not throw.
  }
}

/** The invite code in the page URL, if somebody followed a shared link. */
export function readInviteCode(): string | null {
  try {
    const code = new URL(globalThis.location.href).searchParams.get(CODE_PARAM);
    return code ? code.trim().toUpperCase() : null;
  } catch {
    return null;
  }
}

/**
 * Puts the world's code in the address bar so the page can be reloaded or
 * shared and land in the same world. Replaces rather than pushes, so it does
 * not fill the back button with identical entries.
 */
export function showInviteCode(code: string): void {
  try {
    const url = new URL(globalThis.location.href);
    if (url.searchParams.get(CODE_PARAM) === code) return;
    url.searchParams.set(CODE_PARAM, code);
    globalThis.history?.replaceState(null, '', url.toString());
  } catch {
    // The address bar is a convenience; failing to update it changes nothing.
  }
}

/** The shareable link for a world. */
export function inviteLink(code: string): string {
  try {
    const url = new URL(globalThis.location.href);
    url.searchParams.set(CODE_PARAM, code);
    return url.toString();
  } catch {
    return code;
  }
}

/** Builds the server URL, carrying who we are and where we are going. */
export function farmSocketUrl(base: string, code: string | null, token: string | null): string {
  const url = new URL(base);
  if (code) url.searchParams.set('code', code);
  if (token) url.searchParams.set('token', token);
  return url.toString();
}
