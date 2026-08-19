/**
 * Convenience factories — one call to spawn a managed window or dock region.
 * Thin sugar over `createTransformEntity().addComponent(...)`; everything
 * they do can be done manually with the components.
 */
import {
  Follower,
  FollowBehavior,
  PanelUI,
  PokeInteractable,
  RayInteractable,
  type Entity,
  type World,
} from '@iwsdk/core';
import { UIDockRegion, UIDockedTo, UIWindow, RegionFlowType } from './components.js';
import { DockMode, type DockModeValue } from '@realitycollective/webxr-uiextensions';

export interface CreateWindowOptions {
  /**
   * URL of the UIKitML source (e.g. "/ui/my-window.uikitml"). IWSDK 0.5 parses
   * UIKitML at runtime — the build-time plugin and its generated JSON are gone.
   */
  config: string;
  id?: string;
  title?: string;
  dockMode?: DockModeValue;
  /** World position for world-locked windows. */
  position?: [number, number, number];
  /**
   * Fit the panel into this world-space box (meters), preserving aspect ratio.
   * Replaces the `PanelUI.maxWidth/maxHeight` fields removed in IWSDK 0.5.
   * Omit to keep the markup's intrinsic size and scale via the entity transform.
   */
  maxWidth?: number;
  maxHeight?: number;
  movable?: boolean;
  closable?: boolean;
  minimizable?: boolean;
  pinnable?: boolean;
  billboardWhileDragging?: boolean;
  followOffset?: [number, number, number];
  followSpeed?: number;
  followTolerance?: number;
  /** Dock straight into this region on spawn. */
  region?: string;
}

export function createUIWindow(world: World, options: CreateWindowOptions): Entity {
  const entity = world
    .createTransformEntity()
    .addComponent(PanelUI, {
      config: options.config,
    })
    .addComponent(UIWindow, {
      // Applied by UIWindowSystem once the document loads — see components.ts.
      targetWidth: options.maxWidth ?? 0,
      targetHeight: options.maxHeight ?? 0,
      windowId: options.id ?? '',
      title: options.title ?? '',
      dockMode: options.dockMode ?? DockMode.WorldLocked,
      movable: options.movable ?? true,
      closable: options.closable ?? true,
      minimizable: options.minimizable ?? true,
      pinnable: options.pinnable ?? true,
      billboardWhileDragging: options.billboardWhileDragging ?? true,
      followOffset: options.followOffset ?? [0, -0.15, -1.2],
      followSpeed: options.followSpeed ?? 3,
      followTolerance: options.followTolerance ?? 0.35,
    })
    .addComponent(RayInteractable)
    .addComponent(PokeInteractable);

  if (options.position) {
    entity.object3D?.position.set(...options.position);
  }
  if (options.region) {
    entity.addComponent(UIDockedTo, { regionId: options.region });
  }
  return entity;
}

export interface CreateDockRegionOptions {
  id: string;
  flow?: (typeof RegionFlowType)[keyof typeof RegionFlowType];
  pitch?: number;
  columns?: number;
  capacity?: number;
  snapRadius?: number;
  /** World position of the region origin. */
  position?: [number, number, number];
  /**
   * Body-lock the region itself: it follows the player's head at
   * `followOffset`, and every window docked into it comes along.
   */
  follow?: boolean;
  followOffset?: [number, number, number];
}

export function createDockRegion(world: World, options: CreateDockRegionOptions): Entity {
  const entity = world.createTransformEntity().addComponent(UIDockRegion, {
    regionId: options.id,
    flow: options.flow ?? RegionFlowType.Column,
    pitch: options.pitch ?? 0.35,
    columns: options.columns ?? 2,
    capacity: options.capacity ?? 0,
    snapRadius: options.snapRadius ?? 0.5,
  });
  if (options.position) {
    entity.object3D?.position.set(...options.position);
  }
  if (options.follow) {
    entity.addComponent(Follower, {
      // Camera, not player.head — the head rig is origin-locked outside XR.
      target: world.camera,
      offsetPosition: options.followOffset ?? [0, -0.2, -1.4],
      behavior: FollowBehavior.PivotY,
    });
  }
  return entity;
}
