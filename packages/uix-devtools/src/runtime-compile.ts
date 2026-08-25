/**
 * Runtime UIKitML panel sources.
 *
 * IWSDK 0.5 changed what `PanelUI.config` points at. On 0.4.x it was a URL to
 * the JSON the `@iwsdk/vite-plugin-uikitml` build step emitted; that plugin was
 * discontinued at 0.4.2. On 0.5.x `PanelUISystem` fetches `config` as TEXT and
 * parses the UIKitML source itself, so there is no compile step left to run.
 *
 * What remains useful at runtime is the pairing of a validated source with a
 * `blob:` URL that `PanelUI` can load like any file:
 *
 *   const panel = compilePanelSource(source);
 *   createUIWindow(world, { config: panel.configUrl, ... });
 *
 * This is the mechanism behind live UX editing (desktop workbench and
 * in-headset editor alike): edit markup → revalidate → respawn the window.
 *
 * Validation uses the same parser IWSDK itself loads (`@drawcall/uikitml`,
 * pinned to the version `@iwsdk/core` depends on), so a source that passes here
 * is a source `PanelUISystem` will accept. Nothing is parsed twice at load time:
 * the parse below exists only to produce diagnostics the editor can show.
 */
import { parse, type ComponentSet } from '@drawcall/uikitml';

export interface CompiledPanel {
  /** The UIKitML source, exactly as `PanelUI.config` will fetch it. */
  source: string;
  /** Validation diagnostics. Empty when the source parses cleanly. */
  errors: string[];
  /**
   * `blob:` URL serving {@link source}; hand this to `PanelUI.config`.
   * Empty string in non-browser environments (node tests).
   */
  configUrl: string;
  /** Release the blob URL once the panel has loaded (or on discard). */
  revoke(): void;
}

export interface CompileOptions {
  /**
   * Component sets to validate against, matching whatever the world was
   * configured with. Omit to validate against the built-in set only - markup
   * using kit components would then report unknown-component diagnostics here
   * even though it loads correctly at runtime.
   */
  componentSets?: ComponentSet[];
}

/**
 * Validate UIKitML source and wrap it in a `blob:` URL for `PanelUI.config`.
 * Collects diagnostics instead of throwing.
 */
export function compilePanelSource(
  source: string,
  options: CompileOptions = {},
): CompiledPanel {
  const errors: string[] = [];

  const result = parse(
    source,
    options.componentSets ? { componentSets: options.componentSets } : {},
  );
  if (!result.success) {
    for (const error of result.errors) {
      errors.push(error.message);
    }
  }

  const blobSupported =
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function' &&
    typeof Blob !== 'undefined';
  /* v8 ignore start -- only reachable in environments without Blob support */
  if (!blobSupported) {
    return { source, errors, configUrl: '', revoke: () => {} };
  }
  /* v8 ignore stop */

  // text/html rather than application/json: 0.5 reads this as UIKitML source.
  const blob = new Blob([source], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  return { source, errors, configUrl: url, revoke: () => URL.revokeObjectURL(url) };
}
