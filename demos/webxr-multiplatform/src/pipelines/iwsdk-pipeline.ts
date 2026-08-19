/**
 * IWSDK pipeline - the full showcase scene, unchanged: the exact same
 * client the library's own demo deploys, driven by the IWSDK adapter.
 *
 * The uix-devtools edit gate rides along under the same rules as the
 * devtools playground: compiled out entirely unless the build sets
 * VITE_UIX_EDIT (or plain local dev), token-guarded where present, editor
 * overlay in its own lazy chunk (reused from the playground demo).
 */
import { installEditGate } from '@realitycollective/uix-devtools';
import { bootstrapShowcase } from '@showcase/world.js';

export async function bootIWSDK(container: HTMLDivElement): Promise<void> {
  const handles = await bootstrapShowcase(container);
  (window as unknown as { uix: unknown }).uix = handles;

  if (import.meta.env.DEV || import.meta.env.VITE_UIX_EDIT) {
    const expected = import.meta.env.VITE_UIX_EDIT_TOKEN as string | undefined;
    const result = installEditGate({
      ...(expected ? { tokens: [expected] } : {}),
      load: (session) =>
        import('@playground/editor-overlay.js').then((m) =>
          m.installEditorOverlay(handles.world, handles.manager, session),
        ),
    });
    if (!result.active) {
      console.info(
        '[lab] no edit session - append ?uix-edit=<token> to activate the live editor.',
      );
    }
  }
}
