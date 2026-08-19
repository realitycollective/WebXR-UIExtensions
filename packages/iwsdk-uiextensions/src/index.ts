/**
 * @realitycollective/iwsdk-uiextensions — the Meta IWSDK adapter.
 *
 * The engine-free UX core (window manager, dock state, region math, drag
 * math, control models, markup upgraders, adapter interfaces) lives in
 * `@realitycollective/webxr-uiextensions` and is re-exported here in full,
 * so this package remains a drop-in single dependency for IWSDK apps.
 *
 * What this package adds is the IWSDK binding: ECS components + systems
 * that apply the core onto `@iwsdk/core` entities, plus the one-call
 * factories and `registerUIExtensions`.
 */
// The portable core — re-exported for a single-dependency experience.
export * from '@realitycollective/webxr-uiextensions';

// IWSDK ECS binding
export * from './components.js';
export * from './manager-registry.js';
export * from './region-registry-store.js';
export * from './factory.js';
export * from './scene-host.js';
export * from './register.js';
export * from './systems/window-system.js';
export * from './systems/dock-system.js';
export * from './systems/drag-system.js';
export * from './systems/dock-region-system.js';
export * from './systems/controls-system.js';
