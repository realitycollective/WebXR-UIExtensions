/**
 * Public entry point of the native adapter, with the same kinds of export as
 * the IWSDK and XR Blocks adapters: the core re-exported, the window host
 * that implements the core's WindowHost and SceneTarget, its options, and
 * the structural types of the `ui` slice the native app installs. The proxy
 * elements and the slice reader stay internal.
 */
export * from '@realitycollective/webxr-uiextensions';
export type { NativeElementNode, NativeUiHost } from './native-types.js';
export { NativeWindowHost } from './host.js';
export type { CreateWindowOptions, NativeWindowHostOptions } from './host.js';
