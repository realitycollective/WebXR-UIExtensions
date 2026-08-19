/**
 * Minimal "Enter VR" overlay for browser boots (adapted from the Pale Signal
 * pattern): a DOM button that launches the XR session and hides while
 * immersed. On desktop the scene stays fully usable with the mouse - the
 * overlay collapses to a hint bar instead of blocking the view.
 */
import { VisibilityState, type World } from '@iwsdk/core';

export function installEnterVROverlay(world: World): void {
  const bar = document.createElement('div');
  Object.assign(bar.style, {
    position: 'fixed',
    left: '0',
    right: '0',
    bottom: '0',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '16px',
    padding: '12px',
    background: 'rgba(8, 14, 22, 0.85)',
    color: '#9fb8d4',
    fontFamily: 'system-ui, sans-serif',
    fontSize: '14px',
    zIndex: '10',
  } satisfies Partial<CSSStyleDeclaration>);

  const hint = document.createElement('span');
  hint.textContent =
    'IWSDK UI Extensions showcase - drag title bars to move windows, PIN toggles follow mode, drop windows on the glowing regions to dock. Works with the mouse here, or:';

  const button = document.createElement('button');
  button.textContent = 'Enter VR';
  Object.assign(button.style, {
    padding: '10px 22px',
    fontSize: '15px',
    fontWeight: 'bold',
    color: '#ffffff',
    background: '#2563b0',
    border: 'none',
    borderRadius: '8px',
    cursor: 'pointer',
  } satisfies Partial<CSSStyleDeclaration>);

  let launching = false;
  button.addEventListener('click', () => {
    if (launching || world.session) {
      return;
    }
    launching = true;
    button.textContent = 'Starting…';
    try {
      world.launchXR();
    } catch (error) {
      console.warn('[showcase] launchXR failed', error);
      launching = false;
      button.textContent = 'Enter VR';
    }
  });

  bar.append(hint, button);
  document.body.appendChild(bar);

  const sync = (state: VisibilityState) => {
    const inSession =
      state === VisibilityState.Visible || state === VisibilityState.VisibleBlurred;
    bar.style.display = inSession ? 'none' : 'flex';
    if (!inSession) {
      launching = false;
      button.textContent = 'Enter VR';
    }
  };
  sync(world.visibilityState.value);
  world.visibilityState.subscribe(sync);

  const xr = (navigator as { xr?: { isSessionSupported(mode: string): Promise<boolean> } }).xr;
  if (!xr) {
    button.style.display = 'none';
    hint.textContent =
      'IWSDK UI Extensions showcase - no WebXR here, but everything works with the mouse: drag title bars, PIN to follow, drop windows on the glowing regions.';
  } else {
    void xr
      .isSessionSupported('immersive-vr')
      .then((supported) => {
        if (!supported) {
          button.style.display = 'none';
        }
      })
      .catch(() => undefined);
  }
}
