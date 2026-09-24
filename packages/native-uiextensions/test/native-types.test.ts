/**
 * `readNativeUiHost`: injected host wins, `globalThis.__rcHost.ui` is the
 * fallback, and a missing slice throws one clear error naming it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { readNativeUiHost, type NativeUiHost } from '../src/native-types.js';
import { createFakeNativeUiHost } from './helpers/fake-native-ui-host.js';

afterEach(() => {
  delete (globalThis as { __rcHost?: unknown }).__rcHost;
});

describe('readNativeUiHost', () => {
  it('returns the injected host without looking at globalThis', () => {
    const injected = createFakeNativeUiHost();
    expect(readNativeUiHost(injected)).toBe(injected);
  });

  it('falls back to globalThis.__rcHost.ui when no host is injected', () => {
    const installed = createFakeNativeUiHost();
    (globalThis as { __rcHost?: { ui?: NativeUiHost } }).__rcHost = { ui: installed };
    expect(readNativeUiHost()).toBe(installed);
  });

  it('throws one clear error naming the "ui" slice when neither is available', () => {
    (globalThis as { __rcHost?: { ui?: NativeUiHost } }).__rcHost = {};
    expect(() => readNativeUiHost()).toThrow(/__rcHost\.ui/);
  });

  it('throws the same error when globalThis.__rcHost itself is missing', () => {
    expect(() => readNativeUiHost()).toThrow(/__rcHost\.ui/);
  });
});
