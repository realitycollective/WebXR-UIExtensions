/**
 * THE playground scene - six windows and two dock regions, as plain data.
 *
 * Engine-free: no IWSDK, no XR Blocks, no three.js. Every demo client feeds
 * this same descriptor to its adapter's `SceneTarget`, so the IWSDK, XR
 * Blocks and desktop pipelines all build the identical playground.
 *
 * Title-bar buttons are opt-in, so each window says which it wants. Three
 * windows show the three ways to use that, and say so in their titles:
 *
 * - Click Machine    - every button on at spawn
 * - Gallery          - no buttons at all; drag is the only chrome
 * - Player Status    - spawned with none, driven from the Window Control
 *                      panel (a stand-in for a hand menu): hide, pin, dock,
 *                      home, minimize, and switching its buttons on
 *
 * The event log keeps its X off: it is the dogfooding surface for every
 * other window's lifecycle, and closing it would hide the evidence.
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
      pinnable: true,
      dockable: true,
      minimizable: true,
      closable: true,
    },
    // Every button on.
    {
      id: 'clicker',
      title: 'Click Machine (all buttons)',
      config: './ui/clicker.uikitml',
      position: [0.55, 1.5, -1.55],
      maxWidth: 0.7,
      maxHeight: 0.9,
      pinnable: true,
      dockable: true,
      minimizable: true,
      closable: true,
    },
    {
      id: 'event-log',
      title: 'Event Log',
      config: './ui/event-log.uikitml',
      position: [1.7, 1.9, -1.5],
      region: 'console-wall',
      maxWidth: 0.85,
      maxHeight: 0.8,
      pinnable: true,
      dockable: true,
      minimizable: true,
    },
    // No buttons: the default. Its title bar still drags.
    {
      id: 'gallery',
      title: 'Gallery (no buttons)',
      config: './ui/gallery.uikitml',
      position: [-1.6, 1.6, -1.2],
      maxWidth: 0.65,
      maxHeight: 0.85,
    },
    // The movable info window: follows the player until pinned in place.
    // Spawned with its buttons OFF; Window Control drives it and can switch
    // them on.
    {
      id: 'player-status',
      title: 'Player Status (menu-driven)',
      config: './ui/player-status.uikitml',
      dockMode: DockMode.BodyFollow,
      followOffset: [0.5, -0.25, -1.05],
      maxWidth: 0.75,
      maxHeight: 0.95,
    },
    // A stand-in for a hand menu: drives Player Status through the manager.
    {
      id: 'window-control',
      title: 'Window Control',
      config: './ui/window-control.uikitml',
      position: [-1.55, 1.05, -1.2],
      maxWidth: 0.6,
      maxHeight: 0.7,
      pinnable: true,
      minimizable: true,
    },
  ],
};
