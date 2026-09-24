/**
 * The `ui` slice of `globalThis.__rcHost` - see NATIVE_HOST_CONTRACT.md,
 * sections "Rules for every slice" and "ui".
 *
 * A native app (OpenXR on Quest, CompositorServices on visionOS, or any other
 * shell) embeds a JavaScript engine such as Hermes, renders panels itself and
 * installs one host object. This package reads its `ui` slice and presents it
 * through the core's `WindowHost` contract, so the panels, the `WindowManager`
 * and the `data-uix` controls are unchanged from web.
 *
 * These are structural types, not the native SDK's own classes: any object
 * shaped like `NativeUiHost` works, whether it came from `globalThis.__rcHost`
 * or a test fake. Every value that crosses the boundary is plain - numbers,
 * strings, booleans, arrays and plain objects - per "Rules for every slice".
 */

import type { SceneRegion } from '@realitycollective/webxr-uiextensions';

/**
 * One element of a panel's tree, as the native host reports it. `handle` is
 * the host's own opaque, stable reference to the element; `id` is the markup
 * id and `componentName` the declared `uix-*` custom element name, both
 * omitted when the element carries neither.
 */
export interface NativeElementNode {
  /** Host-side element handle - opaque, stable for the element's lifetime. */
  handle: string;
  /** Markup id, when the element carries one. */
  id?: string;
  /** The `uix-*` custom element name, when the element was declared as one. */
  componentName?: string;
  /**
   * The element's `data-*` attributes exactly as the markup wrote them, such
   * as `{ "data-uix-id": "count", "data-uix-min": "0" }`. The controls read
   * their settings and their id from these, so a native app must send them.
   */
  attributes?: Record<string, string>;
  children: NativeElementNode[];
}

/**
 * The `ui` slice itself. The JavaScript side keeps the real `WindowManager`
 * and controls; the native app renders panels and windows, and reports back
 * through `onPanelReady` and `onElementEvent`.
 */
export interface NativeUiHost {
  /** Build a bare panel from `config` (compiled UIKitML JSON or a path string) and return its tree, synchronously. */
  createPanel(panelId: string, config: unknown): NativeElementNode;
  /** Ask the host to spawn a managed window. Fire-and-forget: the panel arrives later, through `onPanelReady`. */
  createWindow(windowId: string, config: unknown, options: unknown): void;
  /** A window's panel has finished loading and rendering; `tree` is its element tree. */
  onPanelReady(
    cb: (windowId: string, panelId: string, tree: NativeElementNode) => void,
  ): () => void;
  /** Write properties onto one element of a panel. */
  setProperties(panelId: string, elementHandle: string, props: Record<string, unknown>): void;
  /** An element in some panel raised an event (a press, a value change, …). */
  onElementEvent(
    cb: (panelId: string, elementHandle: string, type: string, payload: unknown) => void,
  ): () => void;
  /** Constrain a panel to fit within width x height meters. */
  setTargetDimensions(panelId: string, width: number, height: number): void;
  /** Release a panel's resources. */
  disposePanel(panelId: string): void;
  /** Apply a `WindowManager` record change (chrome, dock mode, hidden, …) as plain data. */
  applyWindow(record: unknown): void;
  /** A window was closed through the `WindowManager`; tear it down on the host side too. */
  closeWindow(windowId: string): void;
  /**
   * Create a dock region the native app lays windows out in, from a portable
   * scene descriptor's region. Plain data; the app owns the layout.
   */
  createRegion(region: SceneRegion): void;
  /** Remove a region this host created. */
  removeRegion(regionId: string): void;
}

/** The shape of `globalThis.__rcHost` this package cares about: its `ui` slice, if installed. */
interface RcHostLike {
  ui?: NativeUiHost;
}

/**
 * Reads the `ui` slice: the host given (for tests, or a caller that already
 * holds one), or `globalThis.__rcHost.ui`. Every slice except the root is
 * optional, so a native app that has not installed `ui` yet gets one clear
 * error naming the slice, at construction, rather than a confusing failure
 * later.
 */
export function readNativeUiHost(host?: NativeUiHost): NativeUiHost {
  if (host) {
    return host;
  }
  const globalHost = (globalThis as { __rcHost?: RcHostLike }).__rcHost;
  const slice = globalHost?.ui;
  if (!slice) {
    throw new Error(
      '[native-uiextensions] globalThis.__rcHost.ui is missing - the native host has not installed the "ui" slice.',
    );
  }
  return slice;
}
