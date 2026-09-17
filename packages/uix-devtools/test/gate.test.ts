import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_EDIT_PARAM,
  EDIT_SESSION_STORAGE_KEY,
  clearEditSession,
  installEditGate,
  isTokenAccepted,
  readEditToken,
  resolveEditSession,
  type TokenStorage,
} from '../src/gate.js';

function memoryStorage(initial: Record<string, string> = {}): TokenStorage & {
  data: Map<string, string>;
} {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
    removeItem: (key) => void data.delete(key),
  };
}

describe('readEditToken', () => {
  it('reads the token from the default param', () => {
    expect(readEditToken('https://x.test/?uix-edit=abc')).toBe('abc');
  });

  it('supports a custom param name', () => {
    expect(readEditToken('https://x.test/?edit=t0k', 'edit')).toBe('t0k');
  });

  it('returns undefined when absent or empty', () => {
    expect(readEditToken('https://x.test/')).toBeUndefined();
    expect(readEditToken(`https://x.test/?${DEFAULT_EDIT_PARAM}=`)).toBeUndefined();
  });

  it('returns undefined for unparseable URLs', () => {
    expect(readEditToken('not a url')).toBeUndefined();
  });
});

describe('isTokenAccepted', () => {
  it('rejects empty tokens always', () => {
    expect(isTokenAccepted('', undefined)).toBe(false);
    expect(isTokenAccepted('', ['a'])).toBe(false);
  });

  it('accepts any non-empty token when no allow-list is set', () => {
    expect(isTokenAccepted('anything', undefined)).toBe(true);
    expect(isTokenAccepted('anything', [])).toBe(true);
  });

  it('matches against the allow-list exactly', () => {
    expect(isTokenAccepted('good', ['good', 'other'])).toBe(true);
    expect(isTokenAccepted('bad', ['good'])).toBe(false);
  });

  it('ignores empty allow-list entries (unset env vars)', () => {
    expect(isTokenAccepted('x', [''])).toBe(false);
  });
});

describe('resolveEditSession', () => {
  it('opens from a URL token and remembers it', () => {
    const storage = memoryStorage();
    const result = resolveEditSession({
      href: 'https://x.test/?uix-edit=tok',
      tokens: ['tok'],
      storage,
    });
    expect(result.active).toBe(true);
    expect(result.session).toEqual({ token: 'tok', source: 'url' });
    expect(storage.data.get(EDIT_SESSION_STORAGE_KEY)).toBe('tok');
  });

  it('rejects a wrong URL token without remembering it', () => {
    const storage = memoryStorage();
    const result = resolveEditSession({
      href: 'https://x.test/?uix-edit=wrong',
      tokens: ['right'],
      storage,
    });
    expect(result).toEqual({ active: false, rejected: 'wrong' });
    expect(storage.data.size).toBe(0);
  });

  it('falls back to a remembered token', () => {
    const storage = memoryStorage({ [EDIT_SESSION_STORAGE_KEY]: 'tok' });
    const result = resolveEditSession({
      href: 'https://x.test/',
      tokens: ['tok'],
      storage,
    });
    expect(result.active).toBe(true);
    expect(result.session).toEqual({ token: 'tok', source: 'storage' });
  });

  it('evicts a remembered token the allow-list no longer accepts', () => {
    const storage = memoryStorage({ [EDIT_SESSION_STORAGE_KEY]: 'stale' });
    const result = resolveEditSession({
      href: 'https://x.test/',
      tokens: ['fresh'],
      storage,
    });
    expect(result).toEqual({ active: false, rejected: 'stale' });
    expect(storage.data.size).toBe(0);
  });

  it('does not touch storage when remember is false', () => {
    const storage = memoryStorage();
    const result = resolveEditSession({
      href: 'https://x.test/?uix-edit=tok',
      tokens: ['tok'],
      storage,
      remember: false,
    });
    expect(result.active).toBe(true);
    expect(storage.data.size).toBe(0);
  });

  it('stays closed with no URL and no remembered token', () => {
    expect(
      resolveEditSession({ href: 'https://x.test/', storage: memoryStorage() }),
    ).toEqual({ active: false });
  });

  it('stays closed in a non-browser environment with no href', () => {
    expect(resolveEditSession({ storage: memoryStorage() })).toEqual({
      active: false,
    });
  });

  it('works with no storage available at all (node / privacy mode)', () => {
    expect(resolveEditSession({ href: 'https://x.test/' })).toEqual({
      active: false,
    });
    const opened = resolveEditSession({
      href: 'https://x.test/?uix-edit=tok',
      tokens: ['tok'],
    });
    expect(opened.active).toBe(true);
  });

  it('ignores an empty remembered token', () => {
    const storage = memoryStorage({ [EDIT_SESSION_STORAGE_KEY]: '' });
    expect(resolveEditSession({ href: 'https://x.test/', storage })).toEqual({
      active: false,
    });
  });
});

describe('installEditGate', () => {
  it('invokes the loader once with the session when the gate opens', () => {
    const load = vi.fn();
    const result = installEditGate({
      load,
      href: 'https://x.test/?uix-edit=tok',
      tokens: ['tok'],
      storage: memoryStorage(),
    });
    expect(result.active).toBe(true);
    expect(load).toHaveBeenCalledExactlyOnceWith({ token: 'tok', source: 'url' });
  });

  it('does not invoke the loader when the gate stays closed', () => {
    const load = vi.fn();
    const result = installEditGate({
      load,
      href: 'https://x.test/',
      storage: memoryStorage(),
    });
    expect(result.active).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it('contains a loader that throws synchronously', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const result = installEditGate({
      load: () => {
        throw new Error('boom');
      },
      href: 'https://x.test/?uix-edit=tok',
      tokens: ['tok'],
      storage: memoryStorage(),
    });
    expect(result.active).toBe(true);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('contains a loader whose promise rejects', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    installEditGate({
      load: () => Promise.reject(new Error('async boom')),
      href: 'https://x.test/?uix-edit=tok',
      tokens: ['tok'],
      storage: memoryStorage(),
    });
    await vi.waitFor(() => expect(spy).toHaveBeenCalled());
    spy.mockRestore();
  });
});

describe('clearEditSession', () => {
  it('removes the remembered token', () => {
    const storage = memoryStorage({ [EDIT_SESSION_STORAGE_KEY]: 'tok' });
    clearEditSession(storage);
    expect(storage.data.size).toBe(0);
  });

  it('is a no-op when no storage is available', () => {
    expect(() => clearEditSession()).not.toThrow();
  });
});
