/**
 * Multiplatform demo entry.
 *
 * Detects the platform, pre-selects the matching pipeline on a launch
 * screen, and boots NOTHING until the user presses START — proving the
 * chosen implementation actually runs on this browser. All three pipelines
 * are dynamic imports, so a session only downloads the engine it launches.
 */
import { ENGINE_PARAM, chooseEngine, type UixEngine } from './platform-detect.js';

interface ModeInfo {
  title: string;
  blurb: string;
}

const MODES: Record<UixEngine, ModeInfo> = {
  desktop: {
    title: 'Desktop — three.js',
    blurb: 'Plain three.js scene, mouse + orbit controls, vanilla window host. No engine framework.',
  },
  iwsdk: {
    title: 'Meta — IWSDK',
    blurb: 'Full showcase scene on the Meta Immersive Web SDK adapter (mouse works; VR on a Quest).',
  },
  xrblocks: {
    title: 'Google — XR Blocks',
    blurb: 'Same panels hosted inside a Google XR Blocks Script (Android XR; desktop simulator).',
  },
};

const choice = chooseEngine(navigator.userAgent, location.search);
const container = document.getElementById('scene-container') as HTMLDivElement;

async function boot(engine: UixEngine): Promise<void> {
  const badge = document.getElementById('engine-badge');
  if (badge) {
    badge.textContent = `engine: ${engine} — ${MODES[engine].title}`;
    badge.style.display = 'block';
  }
  if (engine === 'desktop') {
    await import('./pipelines/desktop-pipeline.js').then((m) => m.bootDesktop(container));
  } else if (engine === 'xrblocks') {
    await import('./pipelines/xrblocks-pipeline.js').then((m) => m.bootXRBlocks());
  } else {
    await import('./pipelines/iwsdk-pipeline.js').then((m) => m.bootIWSDK(container));
  }
}

function showLaunchScreen(): void {
  const overlay = document.createElement('div');
  overlay.id = 'launch-overlay';
  overlay.setAttribute(
    'style',
    'position:fixed;inset:0;z-index:50;display:flex;flex-direction:column;' +
      'align-items:center;justify-content:center;gap:18px;padding:24px;' +
      'background:#0b1016;color:#dce9f7;font-family:system-ui,sans-serif;text-align:center;',
  );

  let selected: UixEngine = choice.engine;
  const cardById = new Map<UixEngine, HTMLButtonElement>();

  const heading = document.createElement('h1');
  heading.textContent = 'WebXR UI Extensions — Multiplatform Lab';
  heading.setAttribute('style', 'margin:0;font-size:22px;');

  const detected = document.createElement('p');
  detected.textContent = `Detected: ${MODES[choice.engine].title} (${choice.reason})`;
  detected.setAttribute('style', 'margin:0;max-width:640px;font-size:13px;color:#9fb8d4;');

  const cards = document.createElement('div');
  cards.setAttribute(
    'style',
    'display:flex;flex-wrap:wrap;gap:12px;justify-content:center;max-width:820px;',
  );

  const paint = () => {
    for (const [engine, card] of cardById) {
      card.style.borderColor = engine === selected ? '#7db8ff' : '#2e4a66';
      card.style.background = engine === selected ? '#16283c' : '#101a26';
    }
  };

  for (const engine of Object.keys(MODES) as UixEngine[]) {
    const mode = MODES[engine];
    const card = document.createElement('button');
    card.setAttribute(
      'style',
      'width:240px;padding:14px;border-radius:10px;border:2px solid #2e4a66;' +
        'background:#101a26;color:inherit;cursor:pointer;text-align:left;font:inherit;',
    );
    card.innerHTML = `<b>${mode.title}</b><br/><span style="font-size:12px;color:#9fb8d4">${mode.blurb}</span>`;
    card.addEventListener('click', () => {
      selected = engine;
      paint();
    });
    cardById.set(engine, card);
    cards.appendChild(card);
  }
  paint();

  const start = document.createElement('button');
  start.textContent = 'START';
  start.setAttribute(
    'style',
    'padding:12px 48px;font-size:16px;font-weight:bold;border-radius:10px;' +
      'border:0;background:#2c6fb0;color:#fff;cursor:pointer;font-family:inherit;',
  );
  start.addEventListener('click', () => {
    start.disabled = true;
    start.textContent = 'STARTING…';
    // Keep the URL shareable/reload-safe for the chosen mode.
    const url = new URL(location.href);
    url.searchParams.set(ENGINE_PARAM, selected);
    history.replaceState(null, '', url);
    boot(selected)
      .then(() => overlay.remove())
      .catch((error) => {
        console.error('[lab] pipeline failed to start:', error);
        start.disabled = false;
        start.textContent = 'START';
        detected.textContent = `Failed to start ${MODES[selected].title} — see console. Pick a mode and try again.`;
        detected.style.color = '#ff9d7a';
      });
  });

  overlay.append(heading, detected, cards, start);
  document.body.appendChild(overlay);
}

showLaunchScreen();
