/**
 * XR Blocks pipeline - the experimental adapter driving the SAME portable
 * playground descriptor and engine-free behaviour as the other two
 * pipelines, inside a Google XR Blocks Script (Android XR Chrome, or the XR
 * Blocks desktop simulator via ?uix-engine=xrblocks).
 */
import * as horizonKit from '@pmndrs/uikit-horizon';
import { applyScene } from '@realitycollective/webxr-uiextensions';
import { connectUIExtensions, type UixWindowHost } from '@realitycollective/xrblocks-uiextensions';
import type { Object3D } from 'three';
import * as xb from 'xrblocks';
import { installPlaygroundBehaviour } from '@showcase/playground-behaviour.js';
import { PLAYGROUND } from '@showcase/playground-scene.js';

class UixShowcaseScript extends xb.Script {
  private host?: UixWindowHost;

  override async init(): Promise<void> {
    // xrblocks bundles its own three type declarations; at runtime Vite
    // resolves a single `three`, so the cast is type-noise only.
    this.host = connectUIExtensions({
      scene: this as unknown as Object3D,
      camera: xb.camera,
      // renderer.xr gives hand menus the tracked hands in a session.
      xr: xb.core.renderer.xr as never,
      // xb.input gives a title-bar ray drag the controller's live ray, so it
      // rides at a fixed distance (laser math) as IWSDK and native do,
      // rather than by the controller's own position (point-delta).
      input: xb.input as never,
      kit: horizonKit as never,
    });

    installPlaygroundBehaviour(this.host, this.host.manager);
    applyScene(this.host, PLAYGROUND);

    (window as unknown as { uix: unknown }).uix = { host: this.host };

    // Press, poke, hover and drag no longer need wiring here: `UixWindowHost`
    // attaches its own pointer bridge to every panel it creates, driven by
    // XR Blocks' own onSelectStart/End, onObjectTouch*, onObjectGrab* and
    // onHoverEnter/Exit callbacks (see `pointer-bridge.ts`). A manual
    // Script-level `onSelectStart` raycast that clicked on intersection -
    // clicking before release - used to live here; it is gone now that the host
    // clicks on release, as every other platform does.
  }

  override update(): void {
    this.host?.update(xb.getDeltaTime());
  }
}

export async function bootXRBlocks(): Promise<void> {
  xb.add(new UixShowcaseScript());
  await xb.init();
}
