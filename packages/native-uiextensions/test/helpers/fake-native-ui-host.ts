/**
 * In-memory fake of the `ui` slice (`NativeUiHost`), for headless tests.
 *
 * `createPanel` builds a `NativeElementNode` tree straight from a
 * `FakeElementSpec`, synchronously, as the real slice does. `createWindow` is
 * fire-and-forget, exactly like the contract; a test calls `readyWindow` to
 * simulate the native renderer finishing a window's panel. Every other call
 * (`setProperties`, `applyWindow`, `closeWindow`, `disposePanel`) is recorded
 * rather than acted on, and `fireElementEvent` simulates the native side
 * reporting a press or a value change.
 */
import type { NativeElementNode, NativeUiHost } from '../../src/native-types.js';

/** A tiny declarative shape for building a `NativeElementNode` tree in tests. */
export interface FakeElementSpec {
  id?: string;
  componentName?: string;
  attributes?: Record<string, string>;
  children?: FakeElementSpec[];
}

export interface RecordedPropertyWrite {
  panelId: string;
  elementHandle: string;
  props: Record<string, unknown>;
}

export interface RecordedCreateWindow {
  windowId: string;
  config: unknown;
  options: unknown;
}

export interface FakeNativeUiHost extends NativeUiHost {
  /** Every `applyWindow` call the host received, most recent last. */
  readonly appliedWindows: unknown[];
  /** Every `closeWindow` id the host received, in order. */
  readonly closedWindows: string[];
  /** Every `setProperties` call, in order. */
  readonly propertyWrites: RecordedPropertyWrite[];
  /** Every `disposePanel` id the host received, in order. */
  readonly disposedPanels: string[];
  /** Every `createRegion` region the host received, in order. */
  readonly createdRegions: unknown[];
  /** Every `removeRegion` id the host received, in order. */
  readonly removedRegions: string[];
  /** Every `createWindow` call the host received, in order. */
  readonly createWindowCalls: RecordedCreateWindow[];
  /** Simulate the native renderer finishing a window's panel. */
  readyWindow(windowId: string, panelId: string, tree: FakeElementSpec): NativeElementNode;
  /** Simulate an element event arriving from the native side. */
  fireElementEvent(panelId: string, elementHandle: string, type: string, payload?: unknown): void;
}

let handleSequence = 0;

function buildNode(spec: FakeElementSpec): NativeElementNode {
  return {
    handle: `handle-${(handleSequence += 1)}`,
    ...(spec.id !== undefined ? { id: spec.id } : {}),
    ...(spec.componentName !== undefined ? { componentName: spec.componentName } : {}),
    ...(spec.attributes !== undefined ? { attributes: { ...spec.attributes } } : {}),
    children: (spec.children ?? []).map(buildNode),
  };
}

export function createFakeNativeUiHost(): FakeNativeUiHost {
  const panelReadyListeners = new Set<
    (windowId: string, panelId: string, tree: NativeElementNode) => void
  >();
  const elementEventListeners = new Set<
    (panelId: string, elementHandle: string, type: string, payload: unknown) => void
  >();
  const appliedWindows: unknown[] = [];
  const closedWindows: string[] = [];
  const propertyWrites: RecordedPropertyWrite[] = [];
  const disposedPanels: string[] = [];
  const createWindowCalls: RecordedCreateWindow[] = [];
  const createdRegions: unknown[] = [];
  const removedRegions: string[] = [];

  return {
    appliedWindows,
    closedWindows,
    propertyWrites,
    disposedPanels,
    createWindowCalls,
    createdRegions,
    removedRegions,

    createPanel(_panelId: string, config: unknown): NativeElementNode {
      return buildNode(config as FakeElementSpec);
    },

    createWindow(windowId: string, config: unknown, options: unknown): void {
      createWindowCalls.push({ windowId, config, options });
    },

    onPanelReady(cb) {
      panelReadyListeners.add(cb);
      return () => void panelReadyListeners.delete(cb);
    },

    setProperties(panelId, elementHandle, props) {
      propertyWrites.push({ panelId, elementHandle, props });
    },

    onElementEvent(cb) {
      elementEventListeners.add(cb);
      return () => void elementEventListeners.delete(cb);
    },

    setTargetDimensions() {
      // No layout to record headlessly.
    },

    disposePanel(panelId: string): void {
      disposedPanels.push(panelId);
    },

    applyWindow(record: unknown): void {
      appliedWindows.push(record);
    },

    closeWindow(windowId: string): void {
      closedWindows.push(windowId);
    },

    createRegion(region): void {
      createdRegions.push(region);
    },

    removeRegion(regionId: string): void {
      removedRegions.push(regionId);
    },

    readyWindow(windowId, panelId, tree): NativeElementNode {
      const node = buildNode(tree);
      for (const listener of panelReadyListeners) {
        listener(windowId, panelId, node);
      }
      return node;
    },

    fireElementEvent(panelId, elementHandle, type, payload?: unknown): void {
      for (const listener of elementEventListeners) {
        listener(panelId, elementHandle, type, payload);
      }
    },
  };
}
