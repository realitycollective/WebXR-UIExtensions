/**
 * Convenience factories - one call to spawn a managed window or dock region.
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
import {
  DockMode,
  type WindowOptionsBase,
} from '@realitycollective/webxr-uiextensions';

/**
 * Options for {@link createUIWindow}.
 *
 * Everything but `config` comes from the portable {@link WindowOptionsBase},
 * so the same option names mean the same thing on every adapter. `maxWidth`
 * and `maxHeight` route to `UIWindow.targetWidth/Height` here, because IWSDK
 * 0.5 removed those fields from `PanelUI`; omit them to keep the markup's
 * intrinsic size and scale through the entity transform.
 */
export interface CreateWindowOptions extends WindowOptionsBase {
  /**
   * URL of the UIKitML source (e.g. "/ui/my-window.uikitml"). IWSDK 0.5 parses
   * UIKitML at runtime - the build-time plugin and its generated JSON are gone.
   */
  config: string;
  /** Keep the window yawed toward the viewer while it is being dragged. */
  billboardWhileDragging?: boolean;
}

export function createUIWindow(world: World, options: CreateWindowOptions): Entity {
  const entity = world
    .createTransformEntity()
    .addComponent(PanelUI, {
      config: options.config,
    })
    .addComponent(UIWindow, {
      // Applied by UIWindowSystem once the document loads - see components.ts.
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
      // Camera, not player.head - the head rig is origin-locked outside XR.
      target: world.camera,
      offsetPosition: options.followOffset ?? [0, -0.2, -1.4],
      behavior: FollowBehavior.PivotY,
    });
  }
  return entity;
}
