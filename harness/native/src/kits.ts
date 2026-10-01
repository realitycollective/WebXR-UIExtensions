/**
 * The UI Extensions family's host conformance kit and shared suites, run
 * against a native host's test slices on the device, or against this
 * repository's reference fakes under Node. One JSON line per suite and one
 * `done` line at the end, the shape the conversion pipeline's runner reads.
 *
 * On a device the shell installs `__rcShell.testHost`: a second host object
 * (never the live `__rcHost`, whose frames the suites must not disturb)
 * carrying a `ui` slice that draws nothing, an `input` slice, `readbacks.ui`
 * (the `NativeUiTestHost` members the kit reads back through) and `pumpUi()`,
 * which lets the host finish panels and report them. Every settle turn calls
 * `pumpUi()`. Under Node the fakes stand in, so the same bundle proves the
 * bundle.
 *
 * Four suites: the host conformance kit (`nativeUiHostConformanceCases`), and
 * the three shared suites the native binding must pass (`windowHostContractCases`,
 * `sceneTargetContractCases`, `uixElementContractCases`), each over a
 * `NativeWindowHost` built on the test slices and disposed after every case.
 */
import {
  NativeWindowHost,
  nativeUiHostConformanceCases,
  sceneTargetContractCases,
  uixElementContractCases,
  windowHostContractCases,
  type NativeUiHost,
  type NativeUiInputHost,
  type NativeUiTestHost,
  type SceneTarget,
  type UixElementContractSubject,
} from "@realitycollective/native-uiextensions";
import { emit, round, shellGlobal, virtualClock } from "./prelude.js";

/** The panel the kit opens on a device: the window chrome, cooked from `ui/rc-kit-chrome.uikitml`. */
export const KIT_CONFIG = "/ui/rc-kit-chrome.uikitml";

/** One fresh subject for one case. On a device it is the shell's test host every time. */
export interface UiSubject {
  ui: NativeUiHost;
  readbacks: NativeUiTestHost;
  input?: NativeUiInputHost;
  /** Let the host finish panels and report them (`__rcShell.testHost.pumpUi()`). */
  pump(): void;
  /** A panel config the host can build that carries the window chrome ids. */
  kitConfig: unknown;
  /** A panel built from `CONTRACT_PANEL_MARKUP`, or undefined when the host has no driver for it. */
  elementSubject?: () => { subject: UixElementContractSubject; dispose(): void };
}

export interface UiTestSlices {
  source: string;
  fresh(): UiSubject;
}

/**
 * Optional shell driver for the element suite, beside the test host's
 * readbacks: a cooked panel built from `CONTRACT_PANEL_MARKUP` and the two
 * members the suite needs. Without it the element suite is reported skipped.
 */
export interface UiElementDriver {
  /** A config the host builds from `CONTRACT_PANEL_MARKUP` (cooked from `ui/rc-kit-contract.uikitml`). */
  contractConfig: string;
  /** The value of `property` the host is drawing for the element, as last told through `setProperties`. */
  rendered(panelId: string, elementHandle: string, property: string): unknown;
  /** Deliver a user event of `type` to the element, as the host does. */
  fire(panelId: string, elementHandle: string, type: string): void;
}

export interface SuiteResult {
  name: string;
  pass: number;
  fail: number;
  total: number;
  skipped?: number;
  failures: Array<{ name: string; error: string }>;
}

/** The slice with some members replaced; every other member is the slice's own, bound to it. */
export function wrapUi(ui: NativeUiHost, overrides: Partial<NativeUiHost>): NativeUiHost {
  return new Proxy(ui, {
    get(target, key, receiver) {
      const own = (overrides as Record<PropertyKey, unknown>)[key];
      if (own !== undefined) return own;
      const value = Reflect.get(target, key, receiver) as unknown;
      return typeof value === "function" ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

/** The shell's test host, if the shell installed one with the members the suites need. */
export function shellTestSlices(): UiTestSlices | null {
  const test = shellGlobal().testHost;
  if (typeof test !== "object" || test === null) return null;
  const t = test as { ui?: NativeUiHost; input?: NativeUiInputHost; readbacks?: { ui?: NativeUiTestHost }; pumpUi?: () => void; uiDriver?: UiElementDriver };
  if (!t.ui || !t.readbacks?.ui) return null;
  const ui = t.ui;
  const readbacks = t.readbacks.ui;
  const driver = t.uiDriver;
  return {
    source: "shell test host (__rcShell.testHost)",
    fresh: () => ({
      ui,
      readbacks,
      ...(t.input ? { input: t.input } : {}),
      pump: () => t.pumpUi?.(),
      kitConfig: KIT_CONFIG,
      ...(driver ? { elementSubject: () => elementSubjectOver(ui, driver.contractConfig, driver) } : {}),
    }),
  };
}

/** A `UixElementContractSubject` over a `NativeWindowHost` on `ui`, driven by `driver`. */
export function elementSubjectOver(ui: NativeUiHost, config: unknown, driver: Pick<UiElementDriver, "rendered" | "fire">): { subject: UixElementContractSubject; dispose(): void } {
  let panelId = "";
  const spy = wrapUi(ui, {
    createPanel: (id, cfg) => {
      panelId = id;
      return ui.createPanel(id, cfg);
    },
  });
  const host = new NativeWindowHost({ host: spy });
  const root = host.createPanel(config).root;
  const handleOf = (element: unknown): string => (element as { handle: string }).handle;
  return {
    subject: {
      root,
      drive: {
        rendered: (element, property) => driver.rendered(panelId, handleOf(element), property),
        fire: (element, type) => driver.fire(panelId, handleOf(element), type),
      },
    },
    dispose: () => host.dispose(),
  };
}

/** Settle a promise, pumping the host on every turn (bounded). */
async function settlePumping<T>(p: Promise<T>, pump: () => void, turns = 4000): Promise<T> {
  let settled = false;
  let error: unknown;
  let value: T | undefined;
  p.then(
    (v) => {
      settled = true;
      value = v;
    },
    (e) => {
      settled = true;
      error = e;
    },
  );
  for (let i = 0; i < turns && !settled; i += 1) {
    pump();
    await Promise.resolve();
    virtualClock.advance(10);
  }
  if (!settled) throw new Error("the case did not settle (a panel never reported ready?)");
  if (error !== undefined) throw error;
  return value as T;
}

async function runCases<S>(
  name: string,
  cases: readonly { name: string; run(setup: S): void | Promise<void> }[],
  setup: (subject: UiSubject) => S,
  slices: UiTestSlices,
  after: (setup: S) => void = () => undefined,
): Promise<SuiteResult> {
  const result: SuiteResult = { name, pass: 0, fail: 0, total: 0, failures: [] };
  for (const c of cases) {
    result.total += 1;
    const subject = slices.fresh();
    let s: S | undefined;
    try {
      s = setup(subject);
      const out = c.run(s);
      if (out && typeof (out as Promise<void>).then === "function") await settlePumping(out as Promise<void>, subject.pump);
      result.pass += 1;
    } catch (error) {
      result.fail += 1;
      result.failures.push({ name: c.name, error: String((error as Error)?.message ?? error) });
    } finally {
      if (s !== undefined) after(s);
    }
  }
  emit("suite", { name, pass: result.pass, fail: result.fail, total: result.total, failures: result.failures });
  return result;
}

/** A `NativeWindowHost` on the subject's slices, as the shared suites build one. */
function hostOn(subject: UiSubject): NativeWindowHost {
  return new NativeWindowHost({ host: subject.ui, ...(subject.input ? { input: subject.input } : {}) });
}

/** Run every suite this family ships against the slices given. */
export async function runUiKits(slices: UiTestSlices): Promise<{ suites: SuiteResult[]; pass: boolean }> {
  const suites: SuiteResult[] = [];

  suites.push(
    await runCases(
      "ui host kit (nativeUiHostConformanceCases)",
      nativeUiHostConformanceCases(),
      (subject) => ({
        ui: subject.ui,
        testHost: subject.readbacks,
        config: subject.kitConfig,
        waitForPanel: (windowId: string) =>
          new Promise<void>((resolve) => {
            const off = subject.ui.onPanelReady((id) => {
              if (id === windowId) {
                off();
                resolve();
              }
            });
          }),
      }),
      slices,
    ),
  );

  suites.push(
    await runCases(
      "window host (windowHostContractCases over NativeWindowHost)",
      windowHostContractCases(),
      (subject) => {
        const host = hostOn(subject);
        return {
          host,
          manager: host.manager,
          createWindow: (id: string) => host.createWindow({ id, config: subject.kitConfig }),
          attach: () => subject.pump(),
          panelConfig: subject.kitConfig,
        };
      },
      slices,
      (setup) => setup.host.dispose(),
    ),
  );

  const sceneHosts: NativeWindowHost[] = [];
  suites.push(
    await runCases(
      "scene target (sceneTargetContractCases over NativeWindowHost)",
      sceneTargetContractCases(),
      (subject) => {
        const host = hostOn(subject);
        // Every descriptor window is built from the kit's chrome panel: the suite checks the windows, not the panels behind them.
        const target: SceneTarget = {
          spawnRegion: (region) => host.spawnRegion(region),
          spawnWindow: (window) => host.spawnWindow({ ...window, config: subject.kitConfig as string }),
        };
        sceneHosts.push(host);
        return { target, manager: host.manager, settle: () => subject.pump() };
      },
      slices,
      () => sceneHosts.splice(0).forEach((h) => h.dispose()),
    ),
  );

  const elementCases = uixElementContractCases();
  const elementName = "ui elements (uixElementContractCases over NativeWindowHost)";
  if (slices.fresh().elementSubject) {
    const live: Array<{ dispose(): void }> = [];
    suites.push(
      await runCases(
        elementName,
        elementCases,
        (subject) => {
          const made = subject.elementSubject!();
          live.push(made);
          return made.subject;
        },
        slices,
        () => live.splice(0).forEach((m) => m.dispose()),
      ),
    );
  } else {
    emit("suite", {
      name: elementName,
      pass: 0,
      fail: 0,
      total: elementCases.length,
      skipped: elementCases.length,
      failures: [],
      reason: "the test host has no uiDriver (contractConfig, rendered, fire); the suite needs to read what the host draws for an element and to fire an event at it",
    });
    suites.push({ name: elementName, pass: 0, fail: 0, total: elementCases.length, skipped: elementCases.length, failures: [] });
  }

  const pass = suites.every((s) => s.fail === 0);
  emit("kits", { pass, suites: suites.map((s) => ({ name: s.name, pass: s.pass, fail: s.fail, total: s.total, ...(s.skipped ? { skipped: s.skipped } : {}) })), elapsedMs: round(0) });
  return { suites, pass };
}
