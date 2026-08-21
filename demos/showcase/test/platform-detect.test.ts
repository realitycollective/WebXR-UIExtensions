import { describe, expect, it } from 'vitest';
import { chooseEngine, isEngine } from '../src/platform-detect.js';

const QUEST_UA =
  'Mozilla/5.0 (X11; Linux x86_64; Quest 3) AppleWebKit/537.36 (KHTML, like Gecko) OculusBrowser/33.0 Chrome/126.0 Mobile VR Safari/537.36';
const ANDROID_XR_UA =
  'Mozilla/5.0 (Linux; Android 14; AndroidXR) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36';
const DESKTOP_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0 Safari/537.36';

describe('chooseEngine', () => {
  it('picks IWSDK on Meta Horizon OS browsers', () => {
    const choice = chooseEngine(QUEST_UA, '');
    expect(choice.engine).toBe('iwsdk');
    expect(choice.overridden).toBe(false);
  });

  it('picks XR Blocks on Android XR browsers', () => {
    const choice = chooseEngine(ANDROID_XR_UA, '');
    expect(choice.engine).toBe('xrblocks');
  });

  it('picks the plain three.js desktop pipeline everywhere else', () => {
    const choice = chooseEngine(DESKTOP_UA, '');
    expect(choice.engine).toBe('desktop');
    expect(choice.reason).toContain('three.js');
  });

  it('honours the override param above any UA signature', () => {
    expect(chooseEngine(QUEST_UA, '?uix-engine=xrblocks').engine).toBe('xrblocks');
    expect(chooseEngine(ANDROID_XR_UA, '?uix-engine=iwsdk').engine).toBe('iwsdk');
    expect(chooseEngine(QUEST_UA, '?uix-engine=desktop').engine).toBe('desktop');
    expect(chooseEngine(DESKTOP_UA, '?uix-engine=xrblocks').overridden).toBe(true);
  });

  it('ignores unknown override values', () => {
    expect(chooseEngine(DESKTOP_UA, '?uix-engine=unreal').engine).toBe('desktop');
    expect(chooseEngine(DESKTOP_UA, '?uix-engine=unreal').overridden).toBe(false);
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
