/**
 * THE playground scene - five windows and two dock regions, as plain data.
 *
 * Engine-free: no IWSDK, no XR Blocks, no three.js. Every demo client feeds
 * this same descriptor to its adapter's `SceneTarget`, so the IWSDK, XR
 * Blocks and desktop pipelines all build the identical playground.
 */
import {
  DockMode,
  type SceneDescriptor,
} from '@realitycollective/webxr-uiextensions';

export const PLAYGROUND: SceneDescriptor = {
  name: 'IWSDK UI Extensions playground',
  regions: [
    // A world-locked "console wall" on the right: drop windows to stack them.
    {
      id: 'console-wall',
      flow: 'column',
      pitch: 0.62,
      capacity: 3,
      snapRadius: 0.65,
      position: [1.7, 1.9, -1.5],
    },
    // A body-locked shelf that follows the player, low and centered.
    {
      id: 'belt',
      flow: 'row',
      pitch: 0.62,
      capacity: 2,
      snapRadius: 0.5,
      follow: true,
      followOffset: [0, -0.75, -1.1],
    },
  ],
  windows: [
    {
      id: 'registration',
      title: 'Crew Registration',
      config: './ui/registration.uikitml',
      position: [-0.55, 1.55, -1.5],
      maxWidth: 0.9,
      maxHeight: 1.1,
    },
    {
      id: 'clicker',
      title: 'Click Machine',
      config: './ui/clicker.uikitml',
      position: [0.55, 1.5, -1.55],
      maxWidth: 0.7,
      maxHeight: 0.9,
    },
    {
      id: 'event-log',
      title: 'Event Log',
      config: './ui/event-log.uikitml',
      position: [1.7, 1.9, -1.5],
      region: 'console-wall',
      maxWidth: 0.85,
      maxHeight: 0.8,
    },
    {
      id: 'gallery',
      title: 'Gallery',
      config: './ui/gallery.uikitml',
      position: [-1.6, 1.6, -1.2],
      maxWidth: 0.65,
      maxHeight: 0.85,
    },
    // The movable info window: follows the player until pinned in place.
    {
      id: 'player-status',
      title: 'Player Status',
      config: './ui/player-status.uikitml',
      dockMode: DockMode.BodyFollow,
      followOffset: [0.5, -0.25, -1.05],
      maxWidth: 0.75,
      maxHeight: 0.95,
    },
  ],
};
