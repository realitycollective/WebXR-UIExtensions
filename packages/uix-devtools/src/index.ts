/**
 * @realitycollective/uix-devtools — client-side entry.
 *
 * Only the pieces safe to reference from app code are exported here: the
 * edit-session gate (designed to be compiled out of production builds) and
 * the runtime UIKitML compiler that powers live panel editing.
 *
 * The `uix-dev` CLI ships from the same package (`bin/uix-dev.mjs`,
 * `@realitycollective/uix-devtools/cli`) but is node-only — never import it
 * from client code.
 */
export {
  DEFAULT_EDIT_PARAM,
  EDIT_SESSION_STORAGE_KEY,
  clearEditSession,
  installEditGate,
  isTokenAccepted,
  readEditToken,
  resolveEditSession,
  type EditGateOptions,
  type EditGateResult,
  type EditSession,
  type TokenStorage,
} from './gate.js';
export { compilePanelSource, type CompiledPanel } from './runtime-compile.js';
