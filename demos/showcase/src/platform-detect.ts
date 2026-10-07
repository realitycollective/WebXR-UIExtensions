/**
 * Engine selection.
 *
 * You cannot detect "IWSDK vs XR Blocks" - those are frameworks an app is
 * BUILT with, not properties of the device. What you CAN ask is the browser's
 * own WebXR runtime: which immersive session modes it can start. That is the
 * question the Service Framework's `SessionFacet.isSupported` and XR Blocks'
 * own session manager ask (`navigator.xr.isSessionSupported`), and it decides
 * first:
 *
 *  - no immersive WebXR at all          → plain three.js DESKTOP pipeline
 *    (mouse + orbit controls driving the engine-free core through the
 *    vanilla three.js host)
 *  - a Meta Horizon OS browser (Quest)  → IWSDK pipeline
 *  - immersive-ar (Android XR, the
 *    XREAL Aura, an AR-capable phone)   → XR Blocks pipeline
 *  - immersive-vr only, not Meta        → DESKTOP pipeline, as before: IWSDK
 *    ships no desktop camera, so on a PC VR monitor it would draw from a
 *    frozen viewpoint (see the showcase entry). `?uix-engine=iwsdk` still
 *    forces it.
 *
 * The user agent is read for one thing only: telling a Meta browser from any
 * other, which no runtime question can do, since a Quest supports both modes.
 * It never decides whether XR is available. An Android XR browser whose user
 * agent carries no "Android XR" still lands on XR Blocks.
 *
 * Shared by both demo clients, which is why it lives here beside the
 * portable scene rather than in either one:
 *
 *  - the showcase boots the choice directly, and ships two of the three
 *    pipelines - IWSDK where IWSDK is chosen, native three.js everywhere else
 *  - the lab offers the choice on a launch screen and boots nothing until
 *    the user presses START, so all three can be tried on one machine
 *
 * `?uix-engine=desktop|iwsdk|xrblocks` forces a mode in the showcase and
 * pre-selects one in the lab. The override is authoritative.
 */
export type UixEngine = 'desktop' | 'iwsdk' | 'xrblocks';

export interface EngineChoice {
  engine: UixEngine;
  reason: string;
  overridden: boolean;
}

/**
 * What the browser's WebXR runtime answered. `null` means the page has no
 * `navigator.xr` at all: an old browser, or a page not served from a secure
 * context (WebXR needs https or localhost).
 */
export interface XRSupport {
  immersiveVr: boolean;
  immersiveAr: boolean;
}

/** The slice of `navigator.xr` the probe reads. */
export interface XRSupportQuery {
  isSessionSupported(mode: string): Promise<boolean>;
}

export const ENGINE_PARAM = 'uix-engine';

export const ENGINES: readonly UixEngine[] = ['desktop', 'iwsdk', 'xrblocks'];

/** How long the probe waits for one answer before taking it as "no". */
export const XR_PROBE_TIMEOUT_MS = 2000;

const META_BROWSER = /OculusBrowser|Meta Quest|Horizon OS/i;
const ANDROID_XR = /Android\s?XR/i;

export function isEngine(value: string | null): value is UixEngine {
  return value !== null && (ENGINES as readonly string[]).includes(value);
}

/**
 * Ask the runtime which immersive modes it can start. Never rejects: a mode
 * whose question throws, or goes unanswered for {@link XR_PROBE_TIMEOUT_MS},
 * counts as unsupported, as the Service Framework's `isSupported` does.
 */
export async function probeXRSupport(
  xr: XRSupportQuery | undefined = (globalThis.navigator as { xr?: XRSupportQuery } | undefined)?.xr,
  timeoutMs: number = XR_PROBE_TIMEOUT_MS,
): Promise<XRSupport | null> {
  if (!xr) return null;
  const ask = (mode: string): Promise<boolean> =>
    new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), timeoutMs);
      xr.isSessionSupported(mode).then(
        (supported) => {
          clearTimeout(timer);
          resolve(supported === true);
        },
        () => {
          clearTimeout(timer);
          resolve(false);
        },
      );
    });
  const [immersiveVr, immersiveAr] = await Promise.all([ask('immersive-vr'), ask('immersive-ar')]);
  return { immersiveVr, immersiveAr };
}

/**
 * Pure chooser - pass `navigator.userAgent`, `location.search` and what
 * {@link probeXRSupport} answered.
 */
export function chooseEngine(userAgent: string, search: string, xr: XRSupport | null): EngineChoice {
  const override = new URLSearchParams(search).get(ENGINE_PARAM);
  if (isEngine(override)) {
    return { engine: override, reason: `forced by ?${ENGINE_PARAM}=${override}`, overridden: true };
  }

  if (!xr) {
    return {
      engine: 'desktop',
      reason: 'this page has no WebXR (navigator.xr is missing - is it served over https?), so the plain three.js pipeline with mouse controls',
      overridden: false,
    };
  }

  if (!xr.immersiveVr && !xr.immersiveAr) {
    return {
      engine: 'desktop',
      reason: 'WebXR reports no immersive session mode here, so the plain three.js pipeline with mouse controls',
      overridden: false,
    };
  }

  const modes = [xr.immersiveVr ? 'immersive-vr' : '', xr.immersiveAr ? 'immersive-ar' : ''].filter(Boolean).join(' and ');

  if (META_BROWSER.test(userAgent)) {
    return { engine: 'iwsdk', reason: `WebXR supports ${modes} in a Meta Horizon OS browser`, overridden: false };
  }

  if (xr.immersiveAr) {
    const where = ANDROID_XR.test(userAgent) ? 'an Android XR browser' : 'an AR-capable browser (Android XR, XREAL Aura, AR phone)';
    return { engine: 'xrblocks', reason: `WebXR supports ${modes} in ${where}`, overridden: false };
  }

  return {
    engine: 'desktop',
    reason: `WebXR supports ${modes} only, outside a Meta browser, so the plain three.js pipeline (force IWSDK with ?${ENGINE_PARAM}=iwsdk)`,
    overridden: false,
  };
}
