/**
 * The shipped `WindowHost` conformance suite, tested against a fake host.
 *
 * The two adapters run these cases for real, which proves they pass. This
 * file proves the other half: that each case FAILS when a host breaks the
 * promise it checks. A contract case that cannot fail is a case that catches
 * nothing, so every assertion inside `src/contract-cases.ts` gets a host
 * built to break it here.
 */
import { describe, expect, it } from 'vitest';
import {
  windowHostContractCases,
  type PanelHandle,
  type PanelReadyEvent,
  type UixElement,
  type WindowHandle,
  type WindowHost,
  type WindowHostContractSetup,
} from '../src/index.js';

const PANELS = 'reports whether bare panels work, and createPanel agrees';
const HANDLE = 'createWindow returns a handle with an id and onReady';
const ONCE = 'onReady fires once when the panel attaches';
const REPLAY = 'onReady replays for a subscriber that arrives late';
const HOST_REPLAY = 'onPanelReady replays for a subscriber that arrives late';

/** One deliberate defect at a time, so each test names the case it breaks. */
interface FakeConfig {
  /** A host whose panel exists as soon as the window does (three.js-like). */
  sync?: boolean;
  supportsStandalonePanels?: unknown;
  createPanel?: 'works' | 'throws';
  id?: unknown;
  onReady?: 'ok' | 'missing' | 'silent' | 'no-replay';
  panel?: 'ok' | 'mismatch';
  unsubscribe?: 'ok' | 'throws' | 'refires';
  onPanelReady?: 'ok' | 'silent';
  panelReadyUnsubscribe?: 'ok' | 'throws';
}

interface FakeHandle {
  id: string;
  panel: PanelHandle | undefined;
  onReady(listener: (panel: PanelHandle) => void): () => void;
}

const ROOT: UixElement = {
  userData: {},
  children: [],
  addEventListener: () => {},
  setProperties: () => {},
};

function makePanel(): PanelHandle {
  return {
    root: ROOT,
    getElementById: () => undefined,
    setTargetDimensions: () => {},
    dispose: () => {},
  };
}

function makeSetup(config: FakeConfig = {}): WindowHostContractSetup {
  const sync = config.sync ?? false;
  const supports = config.supportsStandalonePanels ?? sync;
  const createPanelMode = config.createPanel ?? (sync ? 'works' : 'throws');
  const onReadyMode = config.onReady ?? 'ok';
  const panelMode = config.panel ?? 'ok';
  const unsubscribeMode = config.unsubscribe ?? 'ok';
  const panelReadyMode = config.onPanelReady ?? 'ok';
  const panelReadyUnsubscribe = config.panelReadyUnsubscribe ?? 'ok';

  const events: PanelReadyEvent[] = [];
  const listeners = new Set<(event: PanelReadyEvent) => void>();
  const handles = new Map<string, FakeHandle>();
  const waiting = new Map<string, Set<(panel: PanelHandle) => void>>();

  const host: WindowHost = {
    supportsStandalonePanels: supports as boolean,
    createPanel() {
      if (createPanelMode === 'throws') {
        throw new Error('this host has no bare panels');
      }
      return makePanel();
    },
    onPanelReady(listener) {
      if (panelReadyMode === 'ok') {
        for (const event of events) listener(event);
      }
      listeners.add(listener);
      return () => {
        if (panelReadyUnsubscribe === 'throws') {
          throw new Error('detach failed');
        }
        listeners.delete(listener);
      };
    },
  };

  function attach(id: string): void {
    const handle = handles.get(id);
    if (!handle) return;
    const panel = makePanel();
    handle.panel = panelMode === 'mismatch' ? makePanel() : panel;
    const pending = waiting.get(id);
    if (pending) {
      for (const listener of pending) listener(panel);
      pending.clear();
    }
    const event: PanelReadyEvent = { id, panel, kind: 'window' };
    events.push(event);
    for (const listener of listeners) listener(event);
  }

  function createWindow(id: string): WindowHandle {
    const handle: FakeHandle = {
      id: (config.id ?? id) as string,
      panel: undefined,
      onReady(listener) {
        if (onReadyMode !== 'silent') {
          if (handle.panel === undefined) {
            let pending = waiting.get(id);
            if (!pending) {
              pending = new Set();
              waiting.set(id, pending);
            }
            pending.add(listener);
          } else if (onReadyMode !== 'no-replay') {
            listener(handle.panel);
          }
        }
        return () => {
          if (unsubscribeMode === 'throws') throw new Error('detach failed');
          if (unsubscribeMode === 'refires' && handle.panel !== undefined) {
            listener(handle.panel);
          }
          waiting.get(id)?.delete(listener);
        };
      },
    };
    handles.set(id, handle);
    if (sync) attach(id);
    if (onReadyMode === 'missing') {
      return { id: handle.id, panel: handle.panel } as unknown as WindowHandle;
    }
    return handle;
  }

  const setup: WindowHostContractSetup = {
    host,
    createWindow,
    panelConfig: { element: {}, classes: {} },
  };
  if (!sync) setup.attach = attach;
  return setup;
}

function runCase(name: string, config: FakeConfig): void {
  const contractCase = windowHostContractCases().find(
    (entry) => entry.name === name,
  );
  if (!contractCase) throw new Error(`no contract case named "${name}"`);
  contractCase.run(makeSetup(config));
}

describe('windowHostContractCases', () => {
  it('ships named cases, each with a run function', () => {
    const cases = windowHostContractCases();
    expect(cases.length).toBeGreaterThan(0);
    for (const contractCase of cases) {
      expect(typeof contractCase.name).toBe('string');
      expect(typeof contractCase.run).toBe('function');
    }
    // Two calls hand back the same data; nothing is rebuilt per caller.
    expect(windowHostContractCases()).toBe(cases);
  });

  it('passes a conforming host that attaches its panel later', () => {
    for (const contractCase of windowHostContractCases()) {
      expect(() => contractCase.run(makeSetup())).not.toThrow();
    }
  });

  it('passes a conforming host whose panel exists straight away', () => {
    for (const contractCase of windowHostContractCases()) {
      expect(() => contractCase.run(makeSetup({ sync: true }))).not.toThrow();
    }
  });
});

describe('windowHostContractCases catches a broken host', () => {
  it('rejects a non-boolean supportsStandalonePanels', () => {
    expect(() =>
      runCase(PANELS, { supportsStandalonePanels: 'yes' }),
    ).toThrow(/must be a boolean/);
  });

  it('rejects a host that claims bare panels but throws from createPanel', () => {
    expect(() => runCase(PANELS, { sync: true, createPanel: 'throws' })).toThrow(
      /createPanel\(\) must work/,
    );
  });

  it('rejects a host that refuses bare panels but returns one anyway', () => {
    expect(() => runCase(PANELS, { createPanel: 'works' })).toThrow(
      /must throw rather than return an unusable panel/,
    );
  });

  it('rejects a handle whose id is not a string', () => {
    expect(() => runCase(HANDLE, { id: 7 })).toThrow(/id must be a string/);
  });

  it('rejects a handle that renames the window', () => {
    expect(() => runCase(HANDLE, { id: 'somewhere-else' })).toThrow(
      /must keep the id it was given/,
    );
  });

  it('rejects a handle with no onReady', () => {
    expect(() => runCase(HANDLE, { onReady: 'missing' })).toThrow(
      /must implement onReady/,
    );
  });

  it('rejects a handle whose onReady never fires', () => {
    expect(() => runCase(ONCE, { onReady: 'silent' })).toThrow(
      /must fire exactly once/,
    );
  });

  it('rejects a handle that reports a different panel than it delivered', () => {
    expect(() => runCase(ONCE, { panel: 'mismatch' })).toThrow(
      /same one the handle reports/,
    );
  });

  it('rejects a handle whose onReady does not replay', () => {
    expect(() => runCase(REPLAY, { onReady: 'no-replay' })).toThrow(
      /must replay for a subscriber that arrives after the panel/,
    );
  });

  it('rejects an onReady unsubscribe that throws', () => {
    expect(() => runCase(REPLAY, { unsubscribe: 'throws' })).toThrow(
      /unsubscribe returned by onReady\(\) threw/,
    );
  });

  it('rejects an onReady unsubscribe that delivers the panel again', () => {
    expect(() => runCase(REPLAY, { unsubscribe: 'refires' })).toThrow(
      /must not deliver the panel again/,
    );
  });

  it('rejects a host whose onPanelReady does not replay', () => {
    expect(() => runCase(HOST_REPLAY, { onPanelReady: 'silent' })).toThrow(
      /must replay the windows already live/,
    );
  });

  it('rejects an onPanelReady unsubscribe that throws', () => {
    expect(() =>
      runCase(HOST_REPLAY, { panelReadyUnsubscribe: 'throws' }),
    ).toThrow(/unsubscribe returned by onPanelReady\(\) threw/);
  });

  it('fails loudly when asked for a case that does not exist', () => {
    expect(() => runCase('no such case', {})).toThrow(/no contract case named/);
  });
});
