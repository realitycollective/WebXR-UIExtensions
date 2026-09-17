/**
 * @realitycollective/xrblocks-uiextensions - EXPERIMENTAL Google XR Blocks /
 * plain three.js adapter for the Reality Collective UI Extensions.
 *
 * Binds the engine-free `@realitycollective/webxr-uiextensions` core to any
 * three.js WebXR scene graph - which is exactly what an XR Blocks Script
 * provides. See the README for the current feature matrix versus the IWSDK
 * adapter.
 */
// The portable core - re-exported for a single-dependency experience.
export * from '@realitycollective/webxr-uiextensions';

// three.js / XR Blocks binding
export * from './renderer-setup.js';
export * from './scale-math.js';
export * from './follow-math.js';
export * from './panel-document.js';
export * from './host.js';
export * from './pointer-forward.js';
export * from './xrblocks.js';

// Desktop (mouse + keyboard) support
export * from './desktop-locomotion.js';
export * from './desktop-controls.js';

// `WindowHandle` is declared twice above - once as the core's portable
// interface, once as this host's richer handle. Name the winner explicitly,
// or both star exports drop it. The host's handle satisfies the core one, so
// code written against either keeps compiling.
export type { XrBlocksWindowHandle as WindowHandle } from './host.js';
