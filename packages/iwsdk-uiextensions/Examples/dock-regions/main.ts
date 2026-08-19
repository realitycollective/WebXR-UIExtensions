/**
 * Dock regions — snap windows into named layout regions.
 *
 * A region is an anchor entity with slot layout (row / column / grid).
 * Drop a window inside its snap radius to dock it; drag it out to undock.
 * Regions can follow the player, turning their contents into a toolbar.
 */
import { World } from '@iwsdk/core';
import {
  createDockRegion,
  createUIWindow,
  registerUIExtensions,
} from '@realitycollective/iwsdk-uiextensions';

export async function start(container: HTMLDivElement) {
  const world = await World.create(container, {
    features: { spatialUI: true },
  });
  registerUIExtensions(world);

  // A world-locked column on the wall — drop windows to stack them.
  createDockRegion(world, {
    id: 'wall',
    flow: 'column',
    pitch: 0.6,
    capacity: 3,
    snapRadius: 0.65,
    position: [1.6, 1.9, -1.5],
  });

  // A row that follows the player — a floating toolbar.
  createDockRegion(world, {
    id: 'toolbar',
    flow: 'row',
    pitch: 0.55,
    follow: true,
    followOffset: [0, -0.7, -1.1],
  });

  // Spawn a window straight into a region…
  createUIWindow(world, {
    id: 'docked',
    title: 'Docked Window',
    config: './ui/window.json',
    region: 'wall',
  });

  // …and one free-floating to drag into either region.
  createUIWindow(world, {
    id: 'floating',
    title: 'Drag Me Into A Region',
    config: './ui/window.json',
    position: [0, 1.5, -1.4],
  });
}
