/**
 * IWSDK UI Extensions — showcase world bootstrap.
 *
 * The scene itself is now PORTABLE DATA (`playground-scene.ts`) and the demo
 * behaviour is engine-free (`playground-behaviour.ts`); this module only
 * supplies the IWSDK-specific half — world creation, stage dressing, region
 * markers and the Enter VR overlay — then hands the descriptor to the
 * adapter's scene host. The XR Blocks and desktop pipelines do the same with
 * their own bootstrap, so all three build the identical playground.
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
  World,
} from '@iwsdk/core';
import * as horizonKit from '@pmndrs/uikit-horizon';
import {
  applyScene,
  createSceneHost,
  registerUIExtensions,
  type WindowManager,
} from '@realitycollective/iwsdk-uiextensions';
import { installEnterVROverlay } from './enter-vr.js';
import { installPlaygroundBehaviour } from './playground-behaviour.js';
import { PLAYGROUND } from './playground-scene.js';

export interface ShowcaseHandles {
  world: World;
  manager: WindowManager;
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
      spatialUI: { kits: [horizonKit] },
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
  installPlaygroundBehaviour(host, manager);
  applyScene(host, PLAYGROUND);

  installEnterVROverlay(world);

  return { world, manager };
}
