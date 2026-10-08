/**
 * XR Blocks pipeline - the experimental adapter driving the SAME portable
 * playground descriptor and engine-free behaviour as the other two
 * pipelines, inside a Google XR Blocks Script (Android XR Chrome, or the XR
 * Blocks desktop simulator via ?uix-engine=xrblocks).
 *
 * The page is a Service Framework app. XR Blocks owns the loop (its `Core`
 * calls `setAnimationLoop` itself), so the three.js `WebXRRuntimeAdapter` is
 * built with no `host` and never started: the Script's `update()` drives its
 * frame step with `adapter.tick()`, which emits `renderTick`, and the app
 * service's `render()` ticks the window host from the frame closure.
 */
import * as horizonKit from '@pmndrs/uikit-horizon';
import {
  ManualScheduler,
  ServiceManager,
  createServiceProfile,
} from '@realitycollective/service-framework';
import {
  WebXRRuntimeAdapter,
  type WebXRManagerLike,
  type WebXRSystemLike,
} from '@realitycollective/service-framework-three';
import { applyScene } from '@realitycollective/webxr-uiextensions';
import { connectUIExtensions, type UixWindowHost } from '@realitycollective/xrblocks-uiextensions';
import type { Object3D } from 'three';
import * as xb from 'xrblocks';
import { uixAppRegistration, type UixAppConfig } from '@showcase/app-service.js';
import { installPlaygroundBehaviour } from '@showcase/playground-behaviour.js';
import { PLAYGROUND } from '@showcase/playground-scene.js';
import { fitXRBlocksPage, type XRBlocksPageCore } from './xrblocks-page.js';

class UixShowcaseScript extends xb.Script {
  private host?: UixWindowHost;
  private adapter?: WebXRRuntimeAdapter;

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
      // The renderer gets uikit's transparent sort and local clipping here;
      // XR Blocks sets neither, and without them a panel plate hides its own
      // text (the desktop pipeline calls configureRendererForUikit itself).
      renderer: xb.core.renderer,
    });

    const host = this.host;
    const behaviour = installPlaygroundBehaviour(host, host.manager);
    applyScene(host, PLAYGROUND);

    // The Service Framework app. No `host` and no `start()`: XR Blocks owns
    // the loop, and `update()` below drives the adapter's frame step. The
    // casts are type-noise only, as for the renderer above: the adapter's
    // structural host types do not accept the WebXR typings' `XRSession`
    // under this repository's `exactOptionalPropertyTypes`.
    const scheduler = new ManualScheduler();
    const services = new ServiceManager({ scheduler });
    const adapter = new WebXRRuntimeAdapter({
      xr: xb.core.renderer.xr as unknown as WebXRManagerLike,
      xrSystem: (navigator.xr ?? null) as WebXRSystemLike | null,
      scheduler,
      manager: services,
    });
    const app: UixAppConfig = {
      adapter,
      frame: (deltaSeconds) => host.update(deltaSeconds),
      // Capabilities and session state land in the Event Log window.
      report: behaviour.log,
    };
    services.initializeProfile(
      createServiceProfile('uix-lab-xrblocks', [uixAppRegistration(app)]),
    );
    services.start();
    this.adapter = adapter;
    // Until a session starts the adapter raises no focus or pause of its own, so the browser's
    // page visibility reaches every service from here, as on the desktop pipeline.
    document.addEventListener('visibilitychange', () => {
      const focused = document.visibilityState === 'visible';
      services.emitFocusChange(focused);
      services.emitPauseChange({ paused: !focused });
    });

    // The handles for devtools poking, as the other pipelines publish theirs. The camera lets a
    // test project an element to the screen and click it through XR Blocks' own mouse.
    (window as unknown as { uix: unknown }).uix = {
      host,
      camera: xb.camera,
      core: xb.core,
      services,
      adapter,
    };

    // Press, poke, hover and drag no longer need wiring here: `UixWindowHost`
    // attaches its own pointer bridge to every panel it creates. The bridge
    // gives each panel the one node XR Blocks 0.21 treats as a Script and
    // takes its onObjectSelectStart/End and onObjectGrabStart/End there, and
    // reads rays and fingertips from xb.input's frame (see `pointer-bridge.ts`).
    // A manual Script-level `onSelectStart` raycast that clicked on
    // intersection - clicking before release - used to live here; it is gone
    // now that the host clicks on release, as every other platform does.
  }

  override update(): void {
    // The adapter's frame step: its session gate, then `renderTick`, which
    // reaches the window host through the app service's `render()`.
    this.adapter?.tick(performance.now());
  }
}

export async function bootXRBlocks(container: HTMLElement): Promise<void> {
  xb.add(new UixShowcaseScript());
  await xb.init();
  // Everything XR Blocks draws moves into the mount point, as the other two pipelines draw there,
  // so "did the page render anything" is answered by #scene-container. On a browser that can
  // enter XR the Enter XR button is pinned on screen and the 2D view raised to standing height.
  fitXRBlocksPage(container, xb.core as unknown as XRBlocksPageCore);
}
