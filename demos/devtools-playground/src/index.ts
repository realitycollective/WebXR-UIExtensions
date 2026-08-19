/**
 * uix-devtools playground — the showcase scene plus the edit-session gate.
 *
 * Safety model (see @realitycollective/uix-devtools docs):
 * - The whole gate block is guarded by build flags, so a production build
 *   without VITE_UIX_EDIT contains none of this — the branch is eliminated.
 * - Where compiled in, the gate only opens for the token minted by
 *   `uix-dev tunnel` (or any token in plain local dev, where no token is set).
 * - The editor overlay is a dynamic import — its chunk is never downloaded
 *   unless the gate opens.
 */
import { bootstrapShowcase } from '@showcase/world.js';
import { installEditGate } from '@realitycollective/uix-devtools';

bootstrapShowcase(
  document.getElementById('scene-container') as HTMLDivElement,
).then(({ world, manager }) => {
  (window as unknown as { uix: unknown }).uix = { world, manager };

  if (import.meta.env.DEV || import.meta.env.VITE_UIX_EDIT) {
    const expected = import.meta.env.VITE_UIX_EDIT_TOKEN as string | undefined;
    const result = installEditGate({
      // No token minted (plain `npm run dev`) → open gate, local dev only.
      ...(expected ? { tokens: [expected] } : {}),
      load: (session) =>
        import('./editor-overlay.js').then((m) =>
          m.installEditorOverlay(world, manager, session),
        ),
    });
    if (!result.active) {
      console.info(
        '[playground] no edit session — append ?uix-edit=<token> to activate the live editor.',
      );
    }
  }
});
