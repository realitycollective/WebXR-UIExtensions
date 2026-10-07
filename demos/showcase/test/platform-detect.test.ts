import { describe, expect, it } from 'vitest';
import { chooseEngine, isEngine, probeXRSupport, type XRSupport } from '../src/platform-detect.js';

const QUEST_UA =
  'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/33.0 Chrome/126.0 Mobile VR Safari/537.36';
const ANDROID_XR_UA =
  'Mozilla/5.0 (Linux; Android 14; AndroidXR) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36';
// An Android XR device whose browser does not name itself: the case the XREAL Aura raised.
const UNNAMED_XR_UA =
  'Mozilla/5.0 (Linux; Android 15; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Mobile Safari/537.36';
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36';

const NONE: XRSupport = { immersiveVr: false, immersiveAr: false };
const BOTH: XRSupport = { immersiveVr: true, immersiveAr: true };
const VR_ONLY: XRSupport = { immersiveVr: true, immersiveAr: false };

describe('chooseEngine', () => {
  it('picks IWSDK on a Meta Horizon OS browser with immersive WebXR', () => {
    const choice = chooseEngine(QUEST_UA, '', BOTH);
    expect(choice.engine).toBe('iwsdk');
    expect(choice.overridden).toBe(false);
  });

  it('picks XR Blocks on an Android XR browser with immersive-ar', () => {
    const choice = chooseEngine(ANDROID_XR_UA, '', BOTH);
    expect(choice.engine).toBe('xrblocks');
    expect(choice.reason).toContain('Android XR');
  });

  it('picks XR Blocks from the runtime alone when the user agent names no headset', () => {
    const choice = chooseEngine(UNNAMED_XR_UA, '', BOTH);
    expect(choice.engine).toBe('xrblocks');
    expect(choice.reason).toContain('immersive-ar');
  });

  it('keeps a VR-only browser outside Meta on the desktop pipeline, as IWSDK has no desktop camera', () => {
    const choice = chooseEngine(DESKTOP_UA, '', VR_ONLY);
    expect(choice.engine).toBe('desktop');
    expect(choice.reason).toContain('?uix-engine=iwsdk');
    expect(chooseEngine(QUEST_UA, '', VR_ONLY).engine).toBe('iwsdk');
  });

  it('picks the plain three.js desktop pipeline when the runtime offers no immersive mode', () => {
    const choice = chooseEngine(DESKTOP_UA, '', NONE);
    expect(choice.engine).toBe('desktop');
    expect(choice.reason).toContain('three.js');
  });

  it('never lets a user agent claim XR the runtime does not have', () => {
    expect(chooseEngine(ANDROID_XR_UA, '', NONE).engine).toBe('desktop');
    expect(chooseEngine(QUEST_UA, '', NONE).engine).toBe('desktop');
    const missing = chooseEngine(ANDROID_XR_UA, '', null);
    expect(missing.engine).toBe('desktop');
    expect(missing.reason).toContain('navigator.xr');
  });

  it('honours the override param above any runtime answer or user agent', () => {
    expect(chooseEngine(QUEST_UA, '?uix-engine=xrblocks', BOTH).engine).toBe('xrblocks');
    expect(chooseEngine(ANDROID_XR_UA, '?uix-engine=iwsdk', BOTH).engine).toBe('iwsdk');
    expect(chooseEngine(QUEST_UA, '?uix-engine=desktop', BOTH).engine).toBe('desktop');
    expect(chooseEngine(DESKTOP_UA, '?uix-engine=xrblocks', null).overridden).toBe(true);
  });

  it('ignores unknown override values', () => {
    expect(chooseEngine(DESKTOP_UA, '?uix-engine=unreal', NONE).engine).toBe('desktop');
    expect(chooseEngine(DESKTOP_UA, '?uix-engine=unreal', NONE).overridden).toBe(false);
  });
});

describe('probeXRSupport', () => {
  const runtime = (answers: Record<string, boolean | Error | 'never'>) => ({
    asked: [] as string[],
    isSessionSupported(mode: string): Promise<boolean> {
      this.asked.push(mode);
      const answer = answers[mode] ?? false;
      if (answer === 'never') return new Promise<boolean>(() => {});
      return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
    },
  });

  it('answers null when the page has no navigator.xr', async () => {
    expect(await probeXRSupport(undefined)).toBeNull();
  });

  it('asks the runtime for both immersive modes', async () => {
    const xr = runtime({ 'immersive-vr': false, 'immersive-ar': true });
    expect(await probeXRSupport(xr)).toEqual({ immersiveVr: false, immersiveAr: true });
    expect(xr.asked.sort()).toEqual(['immersive-ar', 'immersive-vr']);
  });

  it('counts a question that throws as unsupported and never rejects', async () => {
    const xr = runtime({ 'immersive-vr': new Error('SecurityError'), 'immersive-ar': true });
    expect(await probeXRSupport(xr)).toEqual({ immersiveVr: false, immersiveAr: true });
  });

  it('counts a question left unanswered past the timeout as unsupported', async () => {
    const xr = runtime({ 'immersive-vr': 'never', 'immersive-ar': true });
    expect(await probeXRSupport(xr, 20)).toEqual({ immersiveVr: false, immersiveAr: true });
  });
});

describe('isEngine', () => {
  it('accepts exactly the three engines', () => {
    expect(isEngine('desktop')).toBe(true);
    expect(isEngine('iwsdk')).toBe(true);
    expect(isEngine('xrblocks')).toBe(true);
    expect(isEngine('unreal')).toBe(false);
    expect(isEngine(null)).toBe(false);
  });
});
