/**
 * Hint bar for the desktop build - the sibling of `enter-vr.ts`.
 *
 * The IWSDK build gets an Enter VR button; this one gets the mouse and
 * keyboard legend, because right-drag-to-look is not a discoverable gesture.
 *
 * It also keeps the PC-VR door open. Routing desktop to three.js would
 * otherwise strand someone with a headset tethered to their PC, who used to
 * reach VR straight from this page, so when the browser reports a working
 * immersive-vr runtime the bar offers a one-click reload into the IWSDK
 * build. Capability-detected, not UA-sniffed: the offer only appears when
 * there is really something to enter.
 */
import { ENGINE_PARAM } from './platform-detect.js';

const BAR_STYLE = {
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
} satisfies Partial<CSSStyleDeclaration>;

export function installDesktopHintBar(): void {
  const bar = document.createElement('div');
  Object.assign(bar.style, BAR_STYLE);

  const hint = document.createElement('span');
  hint.textContent =
    'UI Extensions showcase (desktop build, plain three.js) - drag title bars to move windows, PIN toggles follow mode, drop windows on the glowing regions to dock. Left click drives the UI, WASD walks, right-drag looks around.';

  const button = document.createElement('button');
  button.textContent = 'Enter VR';
  button.style.display = 'none';
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

  // The IWSDK build owns the headset path, so entering VR means reloading
  // into it. Pinning the engine in the URL keeps that reload-safe.
  button.addEventListener('click', () => {
    button.disabled = true;
    button.textContent = 'Loading IWSDK…';
    const url = new URL(location.href);
    url.searchParams.set(ENGINE_PARAM, 'iwsdk');
    location.assign(url.href);
  });

  bar.append(hint, button);
  document.body.appendChild(bar);

  const xr = (
    navigator as { xr?: { isSessionSupported(mode: string): Promise<boolean> } }
  ).xr;
  if (!xr) {
    return;
  }
  void xr
    .isSessionSupported('immersive-vr')
    .then((supported) => {
      if (!supported) {
        return;
      }
      button.style.display = 'block';
      hint.textContent =
        'UI Extensions showcase (desktop build, plain three.js) - drag title bars, PIN toggles follow mode, drop windows on the glowing regions to dock. WASD walks, right-drag looks. Headset attached? The IWSDK build drives it:';
    })
    .catch(() => undefined);
}
