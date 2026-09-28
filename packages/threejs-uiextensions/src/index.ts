/**
 * @realitycollective/threejs-uiextensions - plain three.js / WebXR adapter
 * for the Reality Collective UI Extensions.
 *
 * Binds the engine-free `@realitycollective/webxr-uiextensions` core to any
 * three.js scene graph and, given a `renderer.xr`, drives every interaction
 * rule straight from the browser's WebXR session with no engine SDK beyond
 * three.js itself. `@realitycollective/xrblocks-uiextensions` builds on this
 * package's `UixWindowHost` for its own scene objects and adds only Google
 * XR Blocks' interaction callbacks - see that package's `host.ts`.
 */
// The portable core - re-exported for a single-dependency experience.
export * from '@realitycollective/webxr-uiextensions';

// three.js binding
export * from './renderer-setup.js';
export * from './scale-math.js';
export * from './panel-document.js';
export * from './host.js';
export * from './pointer-bridge.js';
export * from './cursor-visual.js';
export * from './ray-input.js';
export * from './webxr-input.js';
export * from './setup.js';

// `WindowHandle` is declared twice above - once as the core's portable
// interface, once as this host's richer handle. Name the winner explicitly,
// or both star exports drop it. The host's handle satisfies the core one, so
// code written against either keeps compiling.
export type { ThreeJsWindowHandle as WindowHandle } from './host.js';
