/**
 * Runtime UIKitML compilation.
 *
 * The `@iwsdk/vite-plugin-uikitml` build step is literally
 * `JSON.stringify(parse(source))` — so the same `parse` from
 * `@pmndrs/uikitml` can compile panel markup live in the browser. IWSDK's
 * `PanelUI` loads its `config` with a plain `fetch()`, which accepts `blob:`
 * URLs, so a runtime-compiled panel is:
 *
 *   const compiled = compilePanelSource(source);
 *   createUIWindow(world, { config: compiled.configUrl, ... });
 *
 * This is the mechanism behind live UX editing (desktop workbench and
 * in-headset editor alike): edit markup → recompile → respawn the window.
 */
import { parse } from '@pmndrs/uikitml';

export interface CompiledPanel {
  /** Compiled panel JSON, same shape the Vite plugin writes to public/ui. */
  json: string;
  /** Parse diagnostics. Empty when the source compiled cleanly. */
  errors: string[];
  /**
   * `blob:` URL serving {@link json}; hand this to `PanelUI.config`.
   * Empty string in non-browser environments (node tests).
   */
  configUrl: string;
  /** Release the blob URL once the panel has loaded (or on discard). */
  revoke(): void;
}

export interface CompileOptions {
  /**
   * Resolver for `<link ref="...">` stylesheet references in the source —
   * return the CSS text for a path, throw for unknown paths (reported as a
   * diagnostic). Omit to leave linked stylesheets unresolved (inline
   * `<style>` always works).
   */
  resolveFile?: (filePath: string) => string;
}

/** Compile UIKitML source text. Collects errors instead of throwing. */
export function compilePanelSource(
  source: string,
  options: CompileOptions = {},
): CompiledPanel {
  const errors: string[] = [];
  const result = parse(source, {
    onError: (message: string) => {
      errors.push(message);
    },
    ...(options.resolveFile ? { resolveFile: options.resolveFile } : {}),
  });

  if (result.element === undefined) {
    errors.push('UIKitML source produced no root element.');
  }

  const json = JSON.stringify(result, null, 2);

  const blobSupported =
    typeof URL !== 'undefined' &&
    typeof URL.createObjectURL === 'function' &&
    typeof Blob !== 'undefined';
  /* v8 ignore start -- only reachable in environments without Blob support */
  if (!blobSupported) {
    return { json, errors, configUrl: '', revoke: () => {} };
  }
  /* v8 ignore stop */

  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  return { json, errors, configUrl: url, revoke: () => URL.revokeObjectURL(url) };
}
