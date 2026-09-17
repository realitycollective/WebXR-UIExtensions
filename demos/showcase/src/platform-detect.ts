/**
 * Engine selection.
 *
 * You cannot detect "IWSDK vs XR Blocks" - those are frameworks an app is
 * BUILT with, not properties of the device. What you CAN detect is the
 * hardware/browser the page is running on, and choose which pipeline to
 * boot. This demo ships three pipelines (code-split) and picks by
 * signature:
 *
 *  - Meta Horizon OS browser (Quest)  → IWSDK pipeline
 *  - Android XR Chrome                → XR Blocks pipeline
 *  - anything else (desktop/mobile)   → plain three.js DESKTOP pipeline
 *    (mouse + orbit controls driving the engine-free core through the
 *    vanilla three.js host)
 *
 * Shared by both demo clients, which is why it lives here beside the
 * portable scene rather than in either one:
 *
 *  - the showcase boots the choice directly, and ships two of the three
 *    pipelines - IWSDK on Horizon OS, native three.js everywhere else
 *  - the lab offers the choice on a launch screen and boots nothing until
 *    the user presses START, so all three can be tried on one machine
 *
 * `?uix-engine=desktop|iwsdk|xrblocks` forces a mode in the showcase and
 * pre-selects one in the lab. UA sniffing is best-effort by nature; the
 * override is authoritative.
 */
export type UixEngine = 'desktop' | 'iwsdk' | 'xrblocks';

export interface EngineChoice {
  engine: UixEngine;
  reason: string;
  overridden: boolean;
}

export const ENGINE_PARAM = 'uix-engine';

export const ENGINES: readonly UixEngine[] = ['desktop', 'iwsdk', 'xrblocks'];

export function isEngine(value: string | null): value is UixEngine {
  return value !== null && (ENGINES as readonly string[]).includes(value);
}

/** Pure chooser - pass `navigator.userAgent` and `location.search`. */
export function chooseEngine(userAgent: string, search: string): EngineChoice {
  const params = new URLSearchParams(search);
  const override = params.get(ENGINE_PARAM);
  if (isEngine(override)) {
    return {
      engine: override,
      reason: `forced by ?${ENGINE_PARAM}=${override}`,
      overridden: true,
    };
  }

  if (/OculusBrowser|Meta Quest|Horizon OS/i.test(userAgent)) {
    return {
      engine: 'iwsdk',
      reason: 'Meta Horizon OS browser detected',
      overridden: false,
    };
  }

  if (/Android\s?XR/i.test(userAgent)) {
    return {
      engine: 'xrblocks',
      reason: 'Android XR browser detected',
      overridden: false,
    };
  }

  return {
    engine: 'desktop',
    reason: 'no headset signature - plain three.js pipeline with mouse/orbit controls',
    overridden: false,
  };
}
