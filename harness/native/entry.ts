/**
 * The UI Extensions family's native test harness: one bundle a native host
 * runs, built by the WebXR-to-native conversion pipeline (`rc check`, `rc
 * build`) from this repository's own source, and run under Node against the
 * repository's reference fakes when no native host is installed.
 *
 * Modes (`debug.rc.mode` on a device, `__rcShell.mode` under Node):
 *
 *   kits   run every suite this family ships (the host conformance kit and the
 *          shared window host, scene target and element suites) against the
 *          shell's test host, or the fakes under Node; one JSON line per suite
 *          and a `done` line with `pass`. The default under Node.
 *   play   the showcase scene over the live `__rcHost`: the same portable
 *          descriptor and the same engine-free behaviour the web showcase runs,
 *          through the native binding's `NativeWindowHost`, so a person plays
 *          it with hands and controllers. Every `WindowManager` event and every
 *          control event (click, stepper, toggle, expandable label, text) is
 *          logged as a JSON line, and a `status` line follows once a second:
 *          the record feedback is matched against. The default on a device.
 *
 * This harness is UI only: windows and no interactables. The window host
 * runs with its own pointer arbiter and so presents the pointers itself,
 * telling the host each hand's ray and cursor (`applyPointerVisuals`).
 *
 * The bundle contains no engine and no browser: no three.js, no uikit, no
 * IWSDK. The showcase behaviour it reuses talks to the core control models
 * and the `WindowManager` only.
 */
import {
  ExpandableLabelHandle,
  NativeWindowHost,
  StepperHandle,
  ToggleHandle,
  applyScene,
  upgradePanel,
  walk,
  type PanelHandle,
  type SceneDescriptor,
  type UixElement,
  type WindowRecord,
} from "@realitycollective/native-uiextensions";
import { PLAYGROUND } from "../../demos/showcase/src/playground-scene.js";
import { installPlaygroundBehaviour } from "../../demos/showcase/src/playground-behaviour.js";
import { emit, hasShell, readMode, round, shellGlobal, virtualClock } from "./src/prelude.js";
import { runUiKits, shellTestSlices, wrapUi } from "./src/kits.js";
import { referenceTestSlices } from "./src/fakes.js";
import type { NativeUiHost } from "@realitycollective/native-uiextensions";

type Mode = "kits" | "play";
const mode = readMode(hasShell() ? "play" : "kits") as Mode;
const g = globalThis as Record<string, unknown>;

emit("harness", { family: "uiextensions", mode, shell: hasShell() });

let done: { pass: boolean } | null = null;
let displayNow = 0;
let lastDisplayMs: number | null = null;

/** The frame entry the shell calls once per frame with the predicted display time in milliseconds. */
function installTick(tick: (displayMs: number, dt: number) => void): void {
  g.__rcTick = (displayMs: number): void => {
    const dt = lastDisplayMs === null ? 1 / 72 : Math.min(0.1, Math.max(0, (displayMs - lastDisplayMs) / 1000));
    lastDisplayMs = displayMs;
    displayNow = displayMs;
    virtualClock.advance(dt * 1000);
    tick(displayMs, dt);
  };
  g.__rcRenderDone = (): boolean => done !== null;
  g.__rcStatus = (): string => JSON.stringify({ mode, displayMs: round(displayNow, 1), done: done?.pass ?? null });
}

// --- kits ------------------------------------------------------------------------------------
async function runKits(): Promise<void> {
  const slices = shellTestSlices() ?? referenceTestSlices();
  emit("kits-host", { source: slices.source });
  const result = await runUiKits(slices);
  done = { pass: result.pass };
  emit("done", { pass: result.pass, suites: result.suites.length, failures: result.suites.flatMap((s) => s.failures.map((f) => `${s.name}: ${f.name}: ${f.error}`)) });
}

// --- play ------------------------------------------------------------------------------------
/** The panels are cooked to `assets/ui/<name>`; the native host resolves a descriptor's `./ui/x.uikitml` as `/ui/x.uikitml`, the path the kit uses. */
function nativeScene(scene: SceneDescriptor): SceneDescriptor {
  return { ...scene, windows: scene.windows.map((window) => ({ ...window, config: window.config.replace(/^\.\//, "/") })) };
}

function summary(record: WindowRecord): Record<string, unknown> {
  return { window: record.id, title: record.title, dockMode: record.dockMode, region: record.region ?? null, minimized: record.minimized, hidden: record.hidden, dragging: record.dragging };
}

const WINDOW_EVENTS = ["opened", "closed", "focused", "minimized", "restored", "hidden", "shown", "returnHome", "dragStarted", "dragEnded"] as const;
const CHANGE_EVENTS = ["dockChanged", "regionChanged", "chromeChanged", "handMenuChanged", "followChanged"] as const;

function play(): void {
  const live = (g.__rcHost as { ui: NativeUiHost }).ui;
  // What the host was last told about each window's shown flag (hidden, or a closed palm gate): the hand menu's state.
  const shown = new Map<string, boolean>();
  const ui = wrapUi(live, {
    applyWindow: (record) => {
      const r = record as { id?: string; hidden?: boolean };
      if (typeof r.id === "string" && typeof r.hidden === "boolean") {
        const was = shown.get(r.id);
        shown.set(r.id, !r.hidden);
        if (was !== undefined && was !== !r.hidden) emit("event", { at: round(displayNow, 1), source: "host", type: r.hidden ? "windowHidden" : "windowShown", window: r.id });
      }
      live.applyWindow(record);
    },
  });
  const host = new NativeWindowHost({ host: ui });
  const manager = host.manager;

  for (const type of WINDOW_EVENTS) manager.events.on(type, (record: WindowRecord) => emit("event", { at: round(displayNow, 1), source: "window", type, ...summary(record) }));
  for (const type of CHANGE_EVENTS) {
    manager.events.on(type, (change: { window: WindowRecord; previous: unknown }) => emit("event", { at: round(displayNow, 1), source: "window", type, ...summary(change.window), previous: change.previous ?? null }));
  }

  installPlaygroundBehaviour(host, manager);
  host.onPanelReady(({ id, panel }) => wireControlEvents(id, panel));
  applyScene(host, nativeScene(PLAYGROUND));

  let lastSecond = -1;
  installTick((displayMs, dt) => {
    host.update(dt);
    const second = Math.floor(displayMs / 1000);
    if (second !== lastSecond) {
      lastSecond = second;
      const windows = manager.list();
      emit("status", {
        at: round(displayMs, 1),
        windows: windows.map((w) => w.id),
        windowsOpen: manager.count,
        focused: manager.focused?.id ?? null,
        handMenuShown: shown.get("window-control") ?? false,
        hiddenWindows: windows.filter((w) => w.hidden).map((w) => w.id),
      });
    }
  });
  emit("play", { windows: PLAYGROUND.windows.map((w) => w.id), regions: (PLAYGROUND.regions ?? []).map((r) => r.id) });
}

/** One JSON line per click, value change and text entry on a panel's elements, and per stepper, toggle and expandable label change. */
function wireControlEvents(windowId: string, panel: PanelHandle): void {
  const at = (): number => round(displayNow, 1);
  const controls = upgradePanel(panel.root, panel.root as UixElement);
  for (const id of controls.ids()) {
    const handle = controls.get(id);
    if (handle instanceof StepperHandle) handle.events.on("change", (value) => emit("event", { at: at(), source: "control", type: "stepper", window: windowId, id, value }));
    else if (handle instanceof ToggleHandle) handle.events.on("change", (on) => emit("event", { at: at(), source: "control", type: "toggle", window: windowId, id, on }));
    else if (handle instanceof ExpandableLabelHandle) handle.events.on("change", (expanded) => emit("event", { at: at(), source: "control", type: "expandable", window: windowId, id, expanded }));
  }
  walk(panel.root as UixElement, (element) => {
    const id = element.userData["id"];
    if (typeof id !== "string") return;
    element.addEventListener("click", () => emit("event", { at: at(), source: "control", type: "click", window: windowId, id }));
    element.addEventListener("valueChanged", (event) => {
      const value = (event as { value?: unknown } | undefined)?.value;
      emit("event", { at: at(), source: "control", type: typeof value === "string" ? "text" : "value", window: windowId, id, value: value ?? null });
    });
  });
  emit("event", { at: at(), source: "panel", type: "ready", window: windowId, controls: controls.ids() });
}

// --- boot ------------------------------------------------------------------------------------
if (mode === "kits") {
  installTick(() => undefined);
  void runKits().catch((error) => {
    done = { pass: false };
    emit("done", { pass: false, error: String((error as Error)?.stack ?? error) });
  });
} else if (!hasShell()) {
  emit("done", { pass: false, error: `mode "${mode}" needs a native host (__rcHost); under Node use --mode kits` });
  installTick(() => undefined);
  done = { pass: false };
} else {
  shellGlobal();
  play();
}
