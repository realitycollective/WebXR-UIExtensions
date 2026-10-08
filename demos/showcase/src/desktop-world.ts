/**
 * Desktop bootstrap - the showcase scene on plain three.js.
 *
 * The sibling of `world.ts`: same portable playground descriptor, same
 * engine-free behaviour, no XR framework at all. IWSDK is Meta's SDK and
 * takes the view pose from the headset, so it drives this scene on a Horizon
 * OS browser; a desktop browser gets this instead - a hand-rolled three.js
 * scene through the vanilla `UixWindowHost`, with a camera you can actually
 * steer.
 *
 * Both demo clients boot it: the showcase when detection says desktop, and
 * the lab as its desktop pipeline.
 *
 * Input is the real thing: `forwardHtmlEvents` from @pmndrs/pointer-events
 * bridges DOM pointer events into the uikit panels, so hover states, button
 * presses, sliders and text fields behave exactly as they do under IWSDK.
 * WASD/Space/C locomotion stands in for a headset's head tracking.
 *
 * The page is a Service Framework app. The three.js `WebXRRuntimeAdapter`
 * owns the frame loop (`setAnimationLoop` on the renderer) and emits
 * `renderTick`; the manager forwards it to the app service's `render()`
 * (`app-service.ts`), which runs this page's frame closure: controls, the
 * window host, pointer events and the draw.
 */
import {
  AmbientLight,
  DirectionalLight,
  EdgesGeometry,
  GridHelper,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  RingGeometry,
  Scene,
  WebGLRenderer,
} from 'three';
import { forwardHtmlEvents } from '@pmndrs/pointer-events';
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
import {
  DesktopControls,
  UixWindowHost,
  cameraHeadPoseSource,
  webxrHandPoseSource,
  configureRendererForUikit,
  type WindowManager,
} from '@realitycollective/xrblocks-uiextensions';
import { uixAppRegistration, type UixAppConfig } from './app-service.js';
import { installPlaygroundBehaviour } from './playground-behaviour.js';
import { PLAYGROUND } from './playground-scene.js';

/** What a booted desktop scene hands back, mirroring {@link ShowcaseHandles}. */
export interface DesktopShowcaseHandles {
  host: UixWindowHost;
  manager: WindowManager;
  scene: Scene;
  camera: PerspectiveCamera;
  controls: DesktopControls;
  /** The Service Framework manager the app service runs in. */
  services: ServiceManager;
  /** The three.js runtime adapter: it owns the frame loop. */
  adapter: WebXRRuntimeAdapter;
}

export async function bootstrapDesktopShowcase(
  container: HTMLDivElement,
): Promise<DesktopShowcaseHandles> {
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(window.devicePixelRatio);
  renderer.setSize(window.innerWidth, window.innerHeight);
  // REQUIRED for uikit: renderOrder-based transparent sorting + local
  // clipping. Without it, text sorts behind its own panel at some angles.
  configureRendererForUikit(renderer);
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  const camera = new PerspectiveCamera(
    70,
    window.innerWidth / window.innerHeight,
    0.05,
    100,
  );

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // --- Stage dressing (identical to the showcase's) ------------------------
  scene.add(new AmbientLight(0xffffff, 0.9));
  const sun = new DirectionalLight(0xffffff, 1.2);
  sun.position.set(2, 4, 1);
  scene.add(sun);
  scene.add(new GridHelper(12, 24, 0x2e4a66, 0x16283c));

  const wallMarker = new LineSegments(
    new EdgesGeometry(new PlaneGeometry(0.55, 1.5)),
    new LineBasicMaterial({ color: 0x4a8fd0, transparent: true, opacity: 0.5 }),
  );
  wallMarker.position.set(1.7, 1.6, -1.52);
  scene.add(wallMarker);
  const beltMarker = new Mesh(
    new RingGeometry(0.42, 0.46, 48),
    new MeshBasicMaterial({ color: 0x2e6fb0, transparent: true, opacity: 0.3 }),
  );
  beltMarker.rotation.x = -Math.PI / 2;
  beltMarker.position.set(0, 0.02, -1.1);
  scene.add(beltMarker);

  // --- Desktop input --------------------------------------------------------
  // The canonical DOM → three.js pointer bridge: gives uikit real pointer
  // events (hover, down/up, click, capture), not a synthesised click.
  const pointerEvents = forwardHtmlEvents(renderer.domElement, camera, scene);

  // WASD + Space (jump) + C (crouch), right-drag to look.
  const controls = new DesktopControls(camera, {
    domElement: renderer.domElement,
    start: [0, 0.8],
  });

  // --- The playground, from the portable descriptor -------------------------
  const host = new UixWindowHost({
    scene,
    headPose: cameraHeadPoseSource(camera),
    // Hand menus ride the tracked hands once a session starts (Enter VR);
    // until then the source reports no hands and they follow the body.
    handPose: webxrHandPoseSource(renderer.xr),
    kit: horizonKit as never,
  });
  const behaviour = installPlaygroundBehaviour(host, host.manager);
  applyScene(host, PLAYGROUND);

  // --- The Service Framework app ---------------------------------------------
  // The adapter owns the loop: `adapter.start()` binds the renderer's
  // animation loop and each frame emits `renderTick`, which the manager hands
  // to the app service's `render()` and so to `frame` below. This page
  // requests no XR session (the hint bar's Enter VR reloads into the IWSDK
  // build), so the adapter is given no `sessionInit`.
  const scheduler = new ManualScheduler();
  const services = new ServiceManager({ scheduler });
  const adapter = new WebXRRuntimeAdapter({
    // Casts, not conversions: the adapter's structural host types do not
    // accept three's own `WebXRManager` (its `setSession` takes `null`) or the
    // WebXR typings' `XRSession` under this repository's
    // `exactOptionalPropertyTypes`. At run time these are the objects the
    // adapter is written for.
    xr: renderer.xr as unknown as WebXRManagerLike,
    xrSystem: (navigator.xr ?? null) as WebXRSystemLike | null,
    host: renderer,
    scheduler,
    manager: services,
  });
  const app: UixAppConfig = {
    adapter,
    frame: (deltaSeconds) => {
      controls.update(deltaSeconds);
      host.update(deltaSeconds);
      pointerEvents.update();
      renderer.render(scene, camera);
    },
    // Capabilities and session state land in the Event Log window.
    report: behaviour.log,
  };
  services.initializeProfile(
    createServiceProfile('uix-showcase-desktop', [uixAppRegistration(app)]),
  );
  services.start();
  adapter.start();

  // With no XR session the adapter raises no focus or pause of its own, so
  // the browser's page visibility reaches every service from here.
  document.addEventListener('visibilitychange', () => {
    const focused = document.visibilityState === 'visible';
    services.emitFocusChange(focused);
    services.emitPauseChange({ paused: !focused });
  });

  return { host, manager: host.manager, scene, camera, controls, services, adapter };
}
