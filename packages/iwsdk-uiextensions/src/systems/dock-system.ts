/**
 * UIDockSystem - realises dock modes by composing IWSDK components.
 *
 * `body-follow` and `head-locked` are implemented with the IWSDK's own
 * `Follower` / `ScreenSpace` components (reuse, not recreation); this system
 * only plans and applies transitions with the pure dock state machine.
 *
 * `hand-locked` (a hand menu) has no IWSDK component to lean on, so it is
 * placed here each frame: the hand poses come from the player rig's grip
 * spaces (a controller's grip, or the tracked hand), the decision of which
 * hand, whether the palm gate is open and where the panel goes is the core's
 * `evaluateHandMenu`, and the result is written to the entity transform and
 * to `UIWindowState.gateOpen`, which `UIWindowSystem` turns into visibility.
 */
import {
  Follower,
  FollowBehavior,
  ScreenSpace,
  type Entity,
} from '@iwsdk/core';
import { createSystem } from '../create-system.js';
import { Euler, Quaternion, Vector3, type Object3D } from 'three';
import { UIWindow, UIWindowState } from '../components.js';
import {
  DockMode,
  evaluateHandMenu,
  isDockMode,
  planTransition,
  recipeFor,
  type DockModeValue,
  type Hand,
  type HandPoses,
  type PoseTuple,
} from '@realitycollective/webxr-uiextensions';
import { faceViewerYaw } from '@realitycollective/webxr-uiextensions';
import { windowManagerFor } from '../manager-registry.js';
import type { WindowManager } from '@realitycollective/webxr-uiextensions';

export class UIDockSystem extends createSystem({
  windows: { required: [UIWindow, UIWindowState] },
}) {
  private manager!: WindowManager;
  private windowPosition = new Vector3();
  private viewerPosition = new Vector3();
  private handPosition = new Vector3();
  private handQuaternion = new Quaternion();
  private parentQuaternion = new Quaternion();

  override init(): void {
    this.manager = windowManagerFor(this.world);
  }

  override update(): void {
    let hands: HandPoses | undefined;
    for (const entity of this.queries.windows.entities) {
      const requested = entity.getValue(UIWindow, 'dockMode') as DockModeValue;
      const applied = entity.getValue(UIWindowState, 'appliedDockMode') as string;
      if (isDockMode(requested) && applied !== requested) {
        this.apply(entity, applied, requested);
      }
      if (requested === DockMode.HandLocked) {
        hands ??= this.readHands();
        this.placeOnHand(entity, hands);
      }
    }
  }

  /** This frame's tracked hands, in the core's hand frame (WebXR grip convention). */
  private readHands(): HandPoses {
    const poses: HandPoses = {};
    const xr = (this.input as typeof this.input | undefined)?.xr;
    const rig = this.player as { gripSpaces?: Record<Hand, Object3D> } | undefined;
    if (!xr || !rig?.gripSpaces) {
      return poses;
    }
    for (const hand of ['left', 'right'] as const) {
      if (!xr.getPrimaryInputSource(hand)) {
        continue; // nothing tracked on that side this frame
      }
      const space = rig.gripSpaces[hand];
      space.getWorldPosition(this.handPosition);
      space.getWorldQuaternion(this.handQuaternion);
      poses[hand] = {
        position: [this.handPosition.x, this.handPosition.y, this.handPosition.z],
        quaternion: [
          this.handQuaternion.x,
          this.handQuaternion.y,
          this.handQuaternion.z,
          this.handQuaternion.w,
        ],
      };
    }
    return poses;
  }

  private placeOnHand(entity: Entity, hands: HandPoses): void {
    const id = entity.getValue(UIWindow, 'windowId') as string;
    const record = this.manager.get(id);
    const object = entity.object3D;
    if (!record || !object) {
      return;
    }
    this.camera.getWorldPosition(this.viewerPosition);
    const placement = evaluateHandMenu(
      hands,
      [this.viewerPosition.x, this.viewerPosition.y, this.viewerPosition.z],
      record.handMenu,
    );
    if (Boolean(entity.getValue(UIWindowState, 'gateOpen')) !== placement.visible) {
      entity.setValue(UIWindowState, 'gateOpen', placement.visible);
    }
    if (placement.pose) {
      this.applyWorldPose(object, placement.pose);
    }
  }

  /** Write a world pose onto an object whatever it is parented to. */
  private applyWorldPose(object: Object3D, pose: PoseTuple): void {
    this.windowPosition.set(pose.position[0], pose.position[1], pose.position[2]);
    this.handQuaternion.set(
      pose.quaternion[0],
      pose.quaternion[1],
      pose.quaternion[2],
      pose.quaternion[3],
    );
    const parent = object.parent;
    if (parent) {
      parent.worldToLocal(this.windowPosition);
      parent.getWorldQuaternion(this.parentQuaternion).invert();
      this.handQuaternion.premultiply(this.parentQuaternion);
    }
    object.position.copy(this.windowPosition);
    object.quaternion.copy(this.handQuaternion);
  }

  private apply(entity: Entity, applied: string, requested: DockModeValue): void {
    if (isDockMode(applied)) {
      const plan = planTransition(applied, requested);
      if (!plan) {
        return;
      }
      if (plan.removeFollower && entity.hasComponent(Follower)) {
        entity.removeComponent(Follower);
      }
      if (plan.removeFollower && requested === DockMode.WorldLocked) {
        // Pinning in place: leave the window facing the user at the spot it
        // was pinned, instead of freezing whatever lagging follow rotation
        // it happened to have this frame.
        this.faceViewer(entity);
      }
      if (plan.removeScreenSpace && entity.hasComponent(ScreenSpace)) {
        entity.removeComponent(ScreenSpace);
      }
      if (plan.removeHandAnchor) {
        // Off the hand: the gate no longer applies, and the window stays
        // where the hand left it, facing the viewer.
        entity.setValue(UIWindowState, 'gateOpen', true);
        this.faceViewer(entity);
      }
      if (plan.addFollower) {
        // Unpinning: keep the window where the user left it, expressed
        // relative to their head, instead of snapping to the default offset.
        this.addFollower(entity, { fromCurrentPose: true });
      }
      if (plan.addScreenSpace) {
        entity.addComponent(ScreenSpace);
      }
      if (plan.snap && entity.hasComponent(Follower)) {
        entity.setValue(Follower, 'needsPositionSync', true);
      }
    } else {
      // First application after adoption: build the requested recipe from
      // scratch (the entity carries no dock components we own yet).
      const recipe = recipeFor(requested);
      if (recipe.follower && !entity.hasComponent(Follower)) {
        this.addFollower(entity);
      }
      if (!recipe.follower && entity.hasComponent(Follower)) {
        entity.removeComponent(Follower);
      }
      if (recipe.screenSpace && !entity.hasComponent(ScreenSpace)) {
        entity.addComponent(ScreenSpace);
      }
      if (!recipe.screenSpace && entity.hasComponent(ScreenSpace)) {
        entity.removeComponent(ScreenSpace);
      }
    }

    entity.setValue(UIWindowState, 'appliedDockMode', requested);

    const id = entity.getValue(UIWindow, 'windowId') as string;
    if (id && this.manager.has(id)) {
      this.manager.setDockMode(id, requested);
    }
  }

  private faceViewer(entity: Entity): void {
    const object = entity.object3D;
    if (!object) {
      return;
    }
    object.getWorldPosition(this.windowPosition);
    this.camera.getWorldPosition(this.viewerPosition);
    const yaw = faceViewerYaw(
      [this.windowPosition.x, this.windowPosition.y, this.windowPosition.z],
      [this.viewerPosition.x, this.viewerPosition.y, this.viewerPosition.z],
      object.rotation.y,
    );
    object.rotation.set(0, yaw, 0);
  }

  private offsetHelper = new Vector3();
  private yawQuaternion = new Quaternion();
  private yawEuler = new Euler();

  private addFollower(entity: Entity, options: { fromCurrentPose?: boolean } = {}): void {
    const configured = entity.getVectorView(UIWindow, 'followOffset');
    let offset: [number, number, number] = [
      configured[0] ?? 0,
      configured[1] ?? 0,
      configured[2] ?? 0,
    ];

    const object = entity.object3D;
    if (options.fromCurrentPose && object) {
      // Current window position in the viewer's yaw-local frame (matching
      // how Follower's PivotY applies offsets), so following resumes from
      // the same bearing and distance the window was unpinned at.
      object.getWorldPosition(this.offsetHelper);
      this.camera.getWorldPosition(this.windowPosition);
      this.camera.getWorldQuaternion(this.yawQuaternion);
      this.yawEuler.setFromQuaternion(this.yawQuaternion, 'YXZ');
      this.yawEuler.x = 0;
      this.yawEuler.z = 0;
      this.yawQuaternion.setFromEuler(this.yawEuler).conjugate();
      this.offsetHelper.sub(this.windowPosition).applyQuaternion(this.yawQuaternion);
      // Degenerate (window at the viewer): keep the configured offset.
      if (this.offsetHelper.lengthSq() > 0.01) {
        offset = [this.offsetHelper.x, this.offsetHelper.y, this.offsetHelper.z];
      }
    }

    entity.addComponent(Follower, {
      // The camera, not player.head: three.js syncs the camera to the
      // headset pose in-session, while the head rig sits at the origin
      // outside XR (desktop) - following it would park windows at the floor.
      target: this.camera,
      offsetPosition: offset,
      behavior: FollowBehavior.PivotY,
      speed: entity.getValue(UIWindow, 'followSpeed') as number,
      tolerance: entity.getValue(UIWindow, 'followTolerance') as number,
    });
  }
}
