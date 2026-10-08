/**
 * IWSDK UI Extensions - showcase world bootstrap.
 *
 * The scene itself is now PORTABLE DATA (`playground-scene.ts`) and the demo
 * behaviour is engine-free (`playground-behaviour.ts`); this module only
 * supplies the IWSDK-specific half - world creation, stage dressing, region
 * markers and the Enter VR overlay - then hands the descriptor to the
 * adapter's scene host. The XR Blocks and desktop pipelines do the same with
 * their own bootstrap, so all three build the identical playground.
 *
 * The world is a Service Framework app. IWSDK owns its loop, so the IWSDK
 * binding relays frames: `startServiceRuntime` stands up the manager and the
 * adapter, and the bridge system registered with the world emits `renderTick`
 * while the session is visible. The UI Extensions systems keep ticking from
 * the World, so the app service's frame closure has nothing to do here; the
 * service reports the capabilities and session state to the Event Log.
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
  PlaneGeometry,
  RingGeometry,
  SessionMode,
  VisibilityState,
  World,
  createSystem,
} from '@iwsdk/core';
import { createServiceProfile, type ServiceManager } from '@realitycollective/service-framework';
import {
  makeServiceBridgeSystem,
  startServiceRuntime,
  type CreateSystemLike,
  type IWSDKAdapter,
  type IWSDKWorldLike,
} from '@realitycollective/service-framework-iwsdk';
import {
  applyScene,
  createSceneHost,
  registerUIExtensions,
  uixComponentSet,
  type WindowManager,
} from '@realitycollective/iwsdk-uiextensions';
import { uixAppRegistration, type UixAppConfig } from './app-service.js';
import { installEnterVROverlay } from './enter-vr.js';
import { installPlaygroundBehaviour } from './playground-behaviour.js';
import { PLAYGROUND } from './playground-scene.js';

export interface ShowcaseHandles {
  world: World;
  manager: WindowManager;
  /** The Service Framework manager the app service runs in. */
  services: ServiceManager;
  /** The IWSDK runtime adapter: the bridge system relays the World's frames through it. */
  adapter: IWSDKAdapter;
}

export async function bootstrapShowcase(
  container: HTMLDivElement,
): Promise<ShowcaseHandles> {
  const world = await World.create(container, {
    xr: {
      sessionMode: SessionMode.ImmersiveVR,
      offer: 'always',
      features: { handTracking: true },
    },
    features: {
      locomotion: false,
      grabbing: false, // the library's drag system is self-contained
      physics: false,
      // The kit is selected by NAME ('default' | 'horizon'); `uixComponentSet`
      // teaches the parser the `<uix-*>` control elements. Without it a panel
      // using any control fails to parse and never attaches.
      spatialUI: { kit: 'horizon', componentSets: [uixComponentSet] },
    },
  });
  const { scene } = world;

  // --- A minimal stage so the space reads in VR and on desktop -------------
  scene.add(new AmbientLight(0xffffff, 0.9));
  const sun = new DirectionalLight(0xffffff, 1.2);
  sun.position.set(2, 4, 1);
  scene.add(sun);
  scene.add(new GridHelper(12, 24, 0x2e4a66, 0x16283c));

  // Visual markers so the drop zones are discoverable. An outline (not a
  // filled plane) so the zone never reads as an empty broken window.
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

  // --- The window manager + all library systems ----------------------------
  const manager = registerUIExtensions(world);

  // --- The playground, from the portable descriptor -------------------------
  const host = createSceneHost(world);
  const behaviour = installPlaygroundBehaviour(host, manager);
  applyScene(host, PLAYGROUND);

  // --- The Service Framework app ---------------------------------------------
  // IWSDK keeps its own loop and its own Enter VR (it owns the session); the
  // bridge system relays each visible frame to the app service's `render()`.
  //
  // Casts, not conversions. The binding's structural types do not accept
  // IWSDK 1.0.1's own types under this repository's
  // `exactOptionalPropertyTypes` (`World.session` is `XRSession | undefined`).
  // `createSystem` takes its queries first, and the bridge class carries the
  // statics `registerSystem` asks for only at run time.
  const serviceWorld = world as unknown as IWSDKWorldLike<VisibilityState>;
  const { manager: services, adapter } = startServiceRuntime(serviceWorld, (adapter) => {
    const app: UixAppConfig = {
      adapter,
      // The UI Extensions systems tick from the World, not from here.
      frame: () => {},
      // Capabilities and session state land in the Event Log window.
      report: behaviour.log,
    };
    return createServiceProfile('uix-showcase-iwsdk', [uixAppRegistration(app)]);
  });
  const ServiceBridgeSystem = makeServiceBridgeSystem({
    adapter,
    manager: services,
    world: serviceWorld,
    createSystem: createSystem as unknown as CreateSystemLike,
    visibleState: VisibilityState.Visible,
  });
  world.registerSystem(ServiceBridgeSystem as unknown as Parameters<World['registerSystem']>[0]);

  installEnterVROverlay(world);

  return { world, manager, services, adapter };
}
