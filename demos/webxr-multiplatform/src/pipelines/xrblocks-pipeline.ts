/**
 * XR Blocks pipeline - the experimental adapter driving the SAME portable
 * playground descriptor and engine-free behaviour as the other two
 * pipelines, inside a Google XR Blocks Script (Android XR Chrome, or the XR
 * Blocks desktop simulator via ?uix-engine=xrblocks).
 */
import * as horizonKit from '@pmndrs/uikit-horizon';
import { applyScene } from '@realitycollective/webxr-uiextensions';
import {
  connectUIExtensions,
  forwardClick,
  type UixWindowHost,
} from '@realitycollective/xrblocks-uiextensions';
import { Quaternion, Raycaster, Vector3, type Object3D } from 'three';
import * as xb from 'xrblocks';
import { installPlaygroundBehaviour } from '@showcase/playground-behaviour.js';
import { PLAYGROUND } from '@showcase/playground-scene.js';

class UixShowcaseScript extends xb.Script {
  private host?: UixWindowHost;
  private readonly raycaster = new Raycaster();
  private readonly rayOrigin = new Vector3();
  private readonly rayDirection = new Vector3();
  private readonly tempRotation = new Quaternion();

  override async init(): Promise<void> {
    // xrblocks bundles its own three type declarations; at runtime Vite
    // resolves a single `three`, so the cast is type-noise only.
    this.host = connectUIExtensions({
      scene: this as unknown as Object3D,
      camera: xb.camera,
      kit: horizonKit as never,
    });

    installPlaygroundBehaviour(this.host, this.host.manager);
    applyScene(this.host, PLAYGROUND);

    (window as unknown as { uix: unknown }).uix = { host: this.host };
  }

  override update(): void {
    this.host?.update(xb.getDeltaTime());
  }

  override onSelectStart(event: {
    target: {
      getWorldPosition(v: Vector3): Vector3;
      getWorldQuaternion(q: Quaternion): Quaternion;
    };
  }): void {
    // Ray from the selecting controller's pose, -Z forward.
    event.target.getWorldPosition(this.rayOrigin);
    event.target.getWorldQuaternion(this.tempRotation);
    this.rayDirection.set(0, 0, -1).applyQuaternion(this.tempRotation);
    this.raycaster.set(this.rayOrigin, this.rayDirection);
    forwardClick(
      this.raycaster.intersectObject(this as unknown as Object3D, true),
    );
  }
}

export async function bootXRBlocks(): Promise<void> {
  xb.add(new UixShowcaseScript());
  await xb.init();
}
