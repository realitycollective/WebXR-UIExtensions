/**
 * @realitycollective/webxr-uiextensions - the engine-free core.
 *
 * Everything exported here is pure TypeScript with no engine imports
 * (enforced by test/architecture.test.ts): window/dock/region/drag logic,
 * control models, the `data-uix` markup upgraders, the window chrome
 * conventions, and the platform-adapter interfaces engine packages
 * implement.
 */
// Pure logic
export * from './core/events.js';
export * from './core/dock-state.js';
export * from './core/window-manager.js';
export * from './core/region-layout.js';
export * from './core/region-registry.js';
export * from './core/drag-math.js';
export * from './core/hold-to-drag.js';
export * from './core/stepper-model.js';
export * from './core/toggle-model.js';
export * from './core/expandable-model.js';
export * from './core/log-model.js';

// Chrome conventions (markup ids + reference snippet)
export * from './chrome/markup.js';

// Interface-driven control upgraders
export * from './controls/element.js';
export * from './controls/stepper.js';
export * from './controls/toggle.js';
export * from './controls/expandable-label.js';
export * from './controls/log-view.js';
export * from './controls/upgrade.js';

// Platform-adapter contract + portable scene descriptors
export * from './adapter.js';
export * from './scene.js';

// The WindowHost conformance suite, as data an adapter runs in its own runner
export * from './contract-cases.js';
