/**
 * Public entry point of the native adapter, with the same kinds of export as
 * the IWSDK and XR Blocks adapters: the core re-exported, the window host
 * that implements the core's WindowHost and SceneTarget, its options, and
 * the structural types of the slices the native app installs. One addition
 * the web adapters do not need: the host conformance kit, the host cases a
 * native app runs on its device against its real `ui` slice (see
 * `conformance.ts`). The proxy elements and the slice readers stay internal.
 */
export * from '@realitycollective/webxr-uiextensions';
export type {
  NativeElementNode,
  NativePointerKind,
  NativePointerSample,
  NativeUiFrameSource,
  NativeUiHost,
  NativeUiInputHost,
  NativeUiInputSource,
  NativeUiTestHost,
} from './native-types.js';
export { NativeWindowHost } from './host.js';
export type { CreateWindowOptions, NativePointerEvent, NativeWindowHostOptions } from './host.js';
export { nativeUiHostConformanceCases } from './conformance.js';
export type { NativeUiHostConformanceCase, NativeUiHostConformanceSetup } from './conformance.js';
