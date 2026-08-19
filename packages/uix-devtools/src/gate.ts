/**
 * Edit-session launch gate.
 *
 * The gate is how a client opts into dev/edit mode WITHOUT the tooling ever
 * being reachable by players:
 *
 * 1. Production builds compile the whole gate call out behind a build flag
 *    (`if (import.meta.env.VITE_UIX_EDIT) installEditGate(...)`) — the
 *    bundler removes the branch, so the code does not exist in player builds.
 * 2. Where the gate IS compiled in (dev / staging), it only opens when the
 *    page URL carries an explicit session token (`?uix-edit=<token>`) that
 *    matches one the developer minted (`uix-dev tunnel` prints the URL).
 * 3. The dev overlay itself is loaded through the `load` callback — always a
 *    `dynamic import()` — so it lives in a separate chunk that is never even
 *    downloaded for normal visitors.
 *
 * Everything here is DOM-optional and injectable so it is unit-testable in
 * node: pass `href`/`storage` explicitly, or let it default to `window`.
 */

/** Default URL query parameter carrying the edit-session token. */
export const DEFAULT_EDIT_PARAM = 'uix-edit';

/** sessionStorage key used to keep the session alive across reloads. */
export const EDIT_SESSION_STORAGE_KEY = 'uix-devtools:edit-token';

/** An open edit session. */
export interface EditSession {
  /** The token the page presented. */
  token: string;
  /** How the token arrived: fresh from the URL, or remembered from storage. */
  source: 'url' | 'storage';
}

/** Minimal storage surface (sessionStorage-compatible), injectable for tests. */
export interface TokenStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface EditGateOptions {
  /**
   * Loader called exactly once when the gate opens. Do the dynamic import of
   * your dev overlay here so it stays in its own chunk:
   * `load: (session) => import('./dev-overlay.js').then(m => m.install(session))`
   */
  load: (session: EditSession) => void | Promise<unknown>;
  /**
   * Tokens that are allowed to open the gate. Typically
   * `[import.meta.env.VITE_UIX_EDIT_TOKEN]` — minted per run by `uix-dev`.
   * When omitted or empty, ANY non-empty token opens the gate; only do that
   * in local dev builds that never leave your machine.
   */
  tokens?: readonly string[];
  /** URL query parameter name. Default: {@link DEFAULT_EDIT_PARAM}. */
  param?: string;
  /** Page URL to inspect. Default: `window.location.href`. */
  href?: string;
  /**
   * Remember an accepted token in sessionStorage so reloads (e.g. re-entering
   * VR) keep the session without the query param. Default: true.
   */
  remember?: boolean;
  /** Storage override for tests. Default: `window.sessionStorage`. */
  storage?: TokenStorage;
}

export interface EditGateResult {
  /** True when an accepted token opened the gate and `load` was invoked. */
  active: boolean;
  session?: EditSession;
  /** Present when a token arrived but was rejected. */
  rejected?: string;
}

/** Extract the raw edit token from a URL, if any. Pure. */
export function readEditToken(
  href: string,
  param: string = DEFAULT_EDIT_PARAM,
): string | undefined {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return undefined;
  }
  const token = url.searchParams.get(param);
  return token && token.length > 0 ? token : undefined;
}

/** Token acceptance rule. Pure. */
export function isTokenAccepted(
  token: string,
  allowed: readonly string[] | undefined,
): boolean {
  if (token.length === 0) {
    return false;
  }
  if (!allowed || allowed.length === 0) {
    return true; // open gate — local dev only, see EditGateOptions.tokens
  }
  return allowed.some((candidate) => candidate.length > 0 && candidate === token);
}

/* v8 ignore start -- environment shims, exercised only in a real browser */
function defaultHref(): string | undefined {
  return typeof window !== 'undefined' ? window.location.href : undefined;
}

function defaultStorage(): TokenStorage | undefined {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : undefined;
  } catch {
    return undefined; // storage can throw in privacy modes — gate still works
  }
}
/* v8 ignore stop */

/**
 * Resolve the edit session for a page: URL token first, remembered token as
 * fallback. Does NOT invoke any loader — pure resolution, used by
 * {@link installEditGate} and directly testable.
 */
export function resolveEditSession(options: {
  tokens?: readonly string[];
  param?: string;
  href?: string;
  remember?: boolean;
  storage?: TokenStorage;
}): EditGateResult {
  const param = options.param ?? DEFAULT_EDIT_PARAM;
  const remember = options.remember ?? true;
  const storage = options.storage ?? defaultStorage();
  const href = options.href ?? defaultHref();

  const urlToken = href !== undefined ? readEditToken(href, param) : undefined;
  if (urlToken !== undefined) {
    if (!isTokenAccepted(urlToken, options.tokens)) {
      return { active: false, rejected: urlToken };
    }
    if (remember && storage) {
      storage.setItem(EDIT_SESSION_STORAGE_KEY, urlToken);
    }
    return { active: true, session: { token: urlToken, source: 'url' } };
  }

  if (remember && storage) {
    const remembered = storage.getItem(EDIT_SESSION_STORAGE_KEY);
    if (remembered !== null && remembered.length > 0) {
      if (!isTokenAccepted(remembered, options.tokens)) {
        storage.removeItem(EDIT_SESSION_STORAGE_KEY);
        return { active: false, rejected: remembered };
      }
      return { active: true, session: { token: remembered, source: 'storage' } };
    }
  }

  return { active: false };
}

/** Forget a remembered session (e.g. an "exit edit mode" button). */
export function clearEditSession(storage?: TokenStorage): void {
  const target = storage ?? defaultStorage();
  target?.removeItem(EDIT_SESSION_STORAGE_KEY);
}

/**
 * Install the gate: resolve the session and, when it opens, invoke `load`
 * exactly once. Never throws into the host app — a broken overlay must not
 * take the runtime down.
 */
export function installEditGate(options: EditGateOptions): EditGateResult {
  const result = resolveEditSession(options);
  if (result.active && result.session) {
    try {
      const outcome = options.load(result.session);
      if (outcome && typeof (outcome as Promise<unknown>).catch === 'function') {
        (outcome as Promise<unknown>).catch((error) => {
          console.error('[uix-devtools] edit overlay failed to load:', error);
        });
      }
    } catch (error) {
      console.error('[uix-devtools] edit overlay failed to load:', error);
    }
  }
  return result;
}
