/**
 * In-memory fake of the `ui` slice (`NativeUiHost`), for headless tests.
 *
 * It behaves as a CORRECT host would: it places a window exactly where
 * `setWindowPose` says, hides exactly what `applyWindow` marks hidden, and
 * keeps every property written to every element. That makes it the smoke
 * target for the host conformance kit as well as a recorder for binding
 * tests; the kit's proof is still the real host on a device.
 *
 * `createPanel` builds a `NativeElementNode` tree straight from a
 * `FakeElementSpec`, synchronously, as the real slice does. `createWindow` is
 * fire-and-forget, exactly like the contract; a test calls `readyWindow` to
 * simulate the native renderer finishing a window's panel, `pointer` to
 * report a pointer measurement, and `fireElementEvent` for a host-owned
 * element event such as hover.
 */
import type { PoseTuple } from '@realitycollective/webxr-uiextensions';
import type {
  NativeElementNode,
  NativePointerSample,
  NativeUiHost,
  NativeUiTestHost,
} from '../../src/native-types.js';

/** A tiny declarative shape for building a `NativeElementNode` tree in tests. */
export interface FakeElementSpec {
  id?: string;
  componentName?: string;
  attributes?: Record<string, string>;
  /** The element scrolls, with this size and range in pixels. */
  scroll?: { width: number; height: number; maxX: number; maxY: number };
  /** The element is a text field with this value. */
  input?: { value: string; multiline?: boolean; type?: string };
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

export interface RecordedWindowPose {
  windowId: string;
  pose: PoseTuple;
  depthOrder: number;
}

export interface FakeNativeUiHost extends NativeUiHost, NativeUiTestHost {
  /** Every `applyWindow` call the host received, most recent last. */
  readonly appliedWindows: unknown[];
  /** Every `closeWindow` id the host received, in order. */
  readonly closedWindows: string[];
  /** Every `setProperties` call, in order. */
  readonly propertyWrites: RecordedPropertyWrite[];
  /** Every `disposePanel` id the host received, in order. */
  readonly disposedPanels: string[];
  /** Every `createWindow` call the host received, in order. */
  readonly createWindowCalls: RecordedCreateWindow[];
  /** Every `setWindowPose` call, in order. */
  readonly poseCalls: RecordedWindowPose[];
  /** Every `setTargetDimensions` call, in order. */
  readonly dimensionCalls: Array<{ panelId: string; width: number; height: number }>;
  /** Every `setHover` call, in order. */
  readonly hoverCalls: Array<{ panelId: string; elementHandle: string; hovered: boolean }>;
  /** Every `setScroll` call, in order. */
  readonly scrollCalls: Array<{ panelId: string; elementHandle: string; x: number; y: number }>;
  /** Every `showKeyboard` call, in order. */
  readonly keyboardCalls: Array<{ panelId: string; elementHandle: string; value: string; multiline: boolean; type: string }>;
  /** Simulate the user typing on the keyboard: the whole value. */
  typeText(panelId: string, elementHandle: string, value: string): void;
  /** Simulate the user dismissing the keyboard. */
  closeKeyboard(): void;
  /** Simulate the native renderer finishing a window's panel. */
  readyWindow(windowId: string, panelId: string, tree: FakeElementSpec): NativeElementNode;
  /** Simulate a host-owned element event (hover, a value change). */
  fireElementEvent(panelId: string, elementHandle: string, type: string, payload?: unknown): void;
  /** Simulate the host reporting one pointer measurement this frame. */
  pointer(sample: NativePointerSample): void;
  /** The handle of the element with markup id `elementId` in a panel. */
  handleOf(panelId: string, elementId: string): string;
  /** The panel id the host gave a window. */
  panelOf(windowId: string): string | undefined;
}

let handleSequence = 0;

function buildNode(spec: FakeElementSpec): NativeElementNode {
  return {
    handle: `handle-${(handleSequence += 1)}`,
    ...(spec.id !== undefined ? { id: spec.id } : {}),
    ...(spec.componentName !== undefined ? { componentName: spec.componentName } : {}),
    ...(spec.attributes !== undefined ? { attributes: { ...spec.attributes } } : {}),
    ...(spec.scroll !== undefined ? { scroll: { ...spec.scroll } } : {}),
    ...(spec.input !== undefined ? { input: { ...spec.input } } : {}),
    children: (spec.children ?? []).map(buildNode),
  };
}

function indexTree(node: NativeElementNode, byId: Map<string, string>): void {
  if (node.id !== undefined) byId.set(node.id, node.handle);
  for (const child of node.children) indexTree(child, byId);
}

export function createFakeNativeUiHost(): FakeNativeUiHost {
  const panelReadyListeners = new Set<
    (windowId: string, panelId: string, tree: NativeElementNode) => void
  >();
  const elementEventListeners = new Set<
    (panelId: string, elementHandle: string, type: string, payload: unknown) => void
  >();
  const pointerListeners = new Set<(sample: NativePointerSample) => void>();
  const appliedWindows: unknown[] = [];
  const closedWindows: string[] = [];
  const propertyWrites: RecordedPropertyWrite[] = [];
  const disposedPanels: string[] = [];
  const createWindowCalls: RecordedCreateWindow[] = [];
  const poseCalls: RecordedWindowPose[] = [];
  const dimensionCalls: Array<{ panelId: string; width: number; height: number }> = [];
  const hoverCalls: Array<{ panelId: string; elementHandle: string; hovered: boolean }> = [];
  const scrollCalls: Array<{ panelId: string; elementHandle: string; x: number; y: number }> = [];
  const keyboardCalls: Array<{ panelId: string; elementHandle: string; value: string; multiline: boolean; type: string }> = [];
  /** panel id -> handle -> scroll offset, as last told. */
  const scrolled = new Map<string, Map<string, [number, number]>>();
  let keyboard: { panelId: string; elementHandle: string; value: string } | null = null;
  /** panel id -> handle -> hovered, as last told. */
  const hovered = new Map<string, Map<string, boolean>>();
  /** panel id -> markup id -> handle. */
  const markup = new Map<string, Map<string, string>>();
  /** panel id -> handle -> merged properties. */
  const properties = new Map<string, Map<string, Record<string, unknown>>>();
  const panelByWindow = new Map<string, string>();
  const poses = new Map<string, PoseTuple>();
  const hidden = new Map<string, boolean>();

  const register = (panelId: string, node: NativeElementNode): void => {
    const byId = new Map<string, string>();
    indexTree(node, byId);
    markup.set(panelId, byId);
    properties.set(panelId, new Map());
  };

  return {
    appliedWindows,
    closedWindows,
    propertyWrites,
    disposedPanels,
    createWindowCalls,
    poseCalls,
    dimensionCalls,
    hoverCalls,
    scrollCalls,
    keyboardCalls,

    createPanel(panelId: string, config: unknown): NativeElementNode {
      const node = buildNode(config as FakeElementSpec);
      register(panelId, node);
      return node;
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
      const panel = properties.get(panelId);
      if (panel) panel.set(elementHandle, { ...(panel.get(elementHandle) ?? {}), ...props });
    },

    onElementEvent(cb) {
      elementEventListeners.add(cb);
      return () => void elementEventListeners.delete(cb);
    },

    onPointerSample(cb) {
      pointerListeners.add(cb);
      return () => void pointerListeners.delete(cb);
    },

    setWindowPose(windowId, pose, depthOrder) {
      const copy: PoseTuple = {
        position: [pose.position[0], pose.position[1], pose.position[2]],
        quaternion: [pose.quaternion[0], pose.quaternion[1], pose.quaternion[2], pose.quaternion[3]],
      };
      poseCalls.push({ windowId, pose: copy, depthOrder });
      poses.set(windowId, copy);
    },

    setTargetDimensions(panelId, width, height) {
      dimensionCalls.push({ panelId, width, height });
    },

    setScroll(panelId, elementHandle, x, y) {
      scrollCalls.push({ panelId, elementHandle, x, y });
      const panel = scrolled.get(panelId) ?? new Map<string, [number, number]>();
      panel.set(elementHandle, [x, y]);
      scrolled.set(panelId, panel);
    },

    showKeyboard(panelId, elementHandle, request) {
      keyboardCalls.push({ panelId, elementHandle, ...request });
      keyboard = { panelId, elementHandle, value: request.value };
    },

    hideKeyboard() {
      keyboard = null;
    },

    typeText(panelId, elementHandle, value) {
      if (keyboard) keyboard = { ...keyboard, value };
      for (const listener of elementEventListeners) listener(panelId, elementHandle, 'input', { value });
    },

    closeKeyboard() {
      const closing = keyboard;
      keyboard = null;
      if (closing) for (const listener of elementEventListeners) listener(closing.panelId, closing.elementHandle, 'keyboardclosed', undefined);
    },

    scrollPosition(windowId, elementId) {
      const panelId = panelByWindow.get(windowId);
      const handle = panelId === undefined ? undefined : markup.get(panelId)?.get(elementId);
      return panelId === undefined || handle === undefined ? undefined : (scrolled.get(panelId)?.get(handle) ?? [0, 0]);
    },

    keyboardShown() {
      return keyboard;
    },

    setHover(panelId, elementHandle, isHovered) {
      hoverCalls.push({ panelId, elementHandle, hovered: isHovered });
      const panel = hovered.get(panelId) ?? new Map<string, boolean>();
      panel.set(elementHandle, isHovered);
      hovered.set(panelId, panel);
    },

    disposePanel(panelId: string): void {
      disposedPanels.push(panelId);
    },

    applyWindow(record: unknown): void {
      appliedWindows.push(record);
      const { id, hidden: isHidden } = record as { id: string; hidden: boolean };
      hidden.set(id, isHidden);
    },

    closeWindow(windowId: string): void {
      closedWindows.push(windowId);
      poses.delete(windowId);
      hidden.delete(windowId);
    },

    windowPose(windowId) {
      return poses.get(windowId);
    },

    windowHidden(windowId) {
      return hidden.get(windowId);
    },

    elementHandle(windowId, elementId) {
      const panelId = panelByWindow.get(windowId);
      const handle = panelId === undefined ? undefined : markup.get(panelId)?.get(elementId);
      return panelId === undefined || handle === undefined ? undefined : { panelId, elementHandle: handle };
    },

    elementHovered(windowId, elementId) {
      const panelId = panelByWindow.get(windowId);
      const handle = panelId === undefined ? undefined : markup.get(panelId)?.get(elementId);
      return panelId === undefined || handle === undefined ? undefined : (hovered.get(panelId)?.get(handle) ?? false);
    },

    elementProperties(windowId, elementId) {
      const panelId = panelByWindow.get(windowId);
      const handle = panelId === undefined ? undefined : markup.get(panelId)?.get(elementId);
      return panelId === undefined || handle === undefined
        ? undefined
        : properties.get(panelId)?.get(handle);
    },

    measureTouch(windowId, point) {
      const pose = poses.get(windowId);
      if (!pose) return undefined;
      // A correct host: distance along the panel's local +Z, taken to world.
      const [x, y, z, w] = pose.quaternion;
      const normal = [2 * (x * z + w * y), 2 * (y * z - w * x), 1 - 2 * (x * x + y * y)];
      const d = [point[0] - pose.position[0], point[1] - pose.position[1], point[2] - pose.position[2]];
      return {
        signedDistance: d[0]! * normal[0]! + d[1]! * normal[1]! + d[2]! * normal[2]!,
        elementId: 'uix-content',
      };
    },

    readyWindow(windowId, panelId, tree): NativeElementNode {
      const node = buildNode(tree);
      register(panelId, node);
      panelByWindow.set(windowId, panelId);
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

    pointer(sample) {
      for (const listener of pointerListeners) listener(sample);
    },

    handleOf(panelId, elementId) {
      const handle = markup.get(panelId)?.get(elementId);
      if (handle === undefined) throw new Error(`no element "${elementId}" in panel "${panelId}"`);
      return handle;
    },

    panelOf(windowId) {
      return panelByWindow.get(windowId);
    },
  };
}
