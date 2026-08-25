/**
 * Basic window - chrome, focus, docking and drag with one call.
 * Put window.uikitml in your app's public/ui/ folder - IWSDK 0.5 fetches and
 * parses the source at runtime, so there is no compile step.
 */
import { World } from '@iwsdk/core';
import {
  DockMode,
  createUIWindow,
  registerUIExtensions,
} from '@realitycollective/iwsdk-uiextensions';

export async function start(container: HTMLDivElement) {
  const world = await World.create(container, {
    features: { spatialUI: true },
  });

  const windows = registerUIExtensions(world);

  createUIWindow(world, {
    id: 'hello',
    title: 'Hello Window',
    config: './ui/window.uikitml',
    dockMode: DockMode.BodyFollow, // follows until pinned or dragged
    followOffset: [0, -0.15, -1.2],
  });

  windows.events.on('dockChanged', ({ window, previous }) => {
    console.log(`[uix] ${window.title}: ${previous} → ${window.dockMode}`);
  });
  windows.events.on('closed', (w) => console.log(`[uix] ${w.title} closed`));
}
