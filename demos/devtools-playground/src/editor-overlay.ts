/**
 * The live UIKitML editor — a spatial window whose own panel is compiled at
 * runtime by `compilePanelSource`, dogfooding the exact mechanism it offers:
 * edit markup in the textarea (Quest system keyboard works), press SPAWN, and
 * the source is compiled in-browser to a `blob:` config that IWSDK fetches
 * like any other panel. RESPAWN replaces the last spawned window, so a
 * markup → look → tweak loop never leaves the headset.
 *
 * This module is only ever loaded through the edit gate's dynamic import.
 */
import type { World } from '@iwsdk/core';
import {
  createSceneHost,
  createUIWindow,
  type WindowManager,
} from '@realitycollective/iwsdk-uiextensions';
import type { PanelHandle } from '@realitycollective/webxr-uiextensions';
import {
  compilePanelSource,
  type EditSession,
} from '@realitycollective/uix-devtools';

type UikitElement = {
  addEventListener: (type: string, listener: (event?: unknown) => void) => void;
  setProperties: (props: Record<string, unknown>) => void;
};

/** Markup for the editor window itself — also compiled at runtime. */
const EDITOR_PANEL_SOURCE = `
<style>
  .editor { display: flex; flex-direction: column; width: 420; padding: 10;
    background-color: #101a26; background-opacity: 0.94;
    border-color: #7a5cd0; border-width: 1; border-radius: 12.5; }
  .editor-heading { font-size: 12; font-weight: bold; color: #d9ccff; }
  .editor-source { width: 100%; height: 200; margin-top: 8; padding: 6;
    font-size: 9; color: #eaf6ff; background-color: #0a121c;
    border-color: #2e4a66; border-width: 0.75; border-radius: 6; }
  .editor-row { display: flex; flex-direction: row; margin-top: 8; }
  .editor-button { padding: 6; margin-right: 6; font-size: 11; color: #eaf6ff;
    background-color: #4a3a7a; border-radius: 6; cursor: pointer; }
  .editor-button:hover { background-color: #6a54b0; }
  .editor-status { margin-top: 8; font-size: 9; color: #9fb8d4; }
</style>
<div class="editor">
  <text class="editor-heading">UX EDITOR — live UIKitML</text>
  <textarea id="editor-source" class="editor-source"></textarea>
  <div class="editor-row">
    <text id="editor-spawn" class="editor-button">SPAWN</text>
    <text id="editor-respawn" class="editor-button">RESPAWN</text>
    <text id="editor-reset" class="editor-button">RESET</text>
  </div>
  <text id="editor-status" class="editor-status">Edit the markup, then SPAWN.</text>
</div>
`;

/** Starter markup shown in the textarea — a valid minimal panel. */
const STARTER_PANEL_SOURCE = `<style>
  .card { display: flex; flex-direction: column; width: 280; padding: 12;
    background-color: #14261a; background-opacity: 0.92;
    border-color: #3f8f5f; border-width: 1; border-radius: 12.5; }
  .card-title { font-size: 13; font-weight: bold; color: #b8f0cf; }
  .card-body { margin-top: 8; font-size: 10; color: #d5e9dc; }
</style>
<div class="card">
  <text class="card-title">Hello from the headset</text>
  <text class="card-body">Compiled at runtime — edit me and RESPAWN.</text>
</div>`;

const SPAWN_POSITION: [number, number, number] = [0, 1.7, -1.0];

export function installEditorOverlay(
  world: World,
  manager: WindowManager,
  session: EditSession,
): void {
  console.info(`[uix-editor] edit session open (token via ${session.source}).`);

  let source = STARTER_PANEL_SOURCE;
  let spawnCount = 0;
  let lastSpawnedId: string | undefined;

  const editorPanel = compilePanelSource(EDITOR_PANEL_SOURCE);
  createUIWindow(world, {
    id: 'uix-editor',
    title: 'UX Editor',
    config: editorPanel.configUrl,
    position: [-0.15, 1.35, -0.95],
    maxWidth: 1.0,
    maxHeight: 1.0,
    closable: false,
  });

  // Panels load asynchronously; the host's portable readiness signal tells
  // us exactly when this one is wireable (no polling, no ECS queries).
  const host = createSceneHost(world);
  const unsubscribe = host.onPanelReady(({ id, panel }) => {
    if (id !== 'uix-editor') {
      return;
    }
    unsubscribe();
    editorPanel.revoke();
    wireEditor(panel);
  });

  function wireEditor(panel: PanelHandle): void {
    const element = (id: string) =>
      panel.getElementById(id) as unknown as UikitElement | undefined;
    const status = element('editor-status');
    const say = (text: string, ok = true) =>
      status?.setProperties({ text, color: ok ? '#9fb8d4' : '#ff9d7a' });

    element('editor-source')?.setProperties({
      defaultValue: source,
      onValueChange: (value: string) => {
        source = value;
      },
    });

    const spawn = (replaceLast: boolean) => {
      const compiled = compilePanelSource(source);
      if (compiled.errors.length > 0) {
        say(`Parse failed: ${compiled.errors[0]}`, false);
        compiled.revoke();
        return;
      }
      if (replaceLast && lastSpawnedId) {
        manager.close(lastSpawnedId);
      }
      spawnCount += 1;
      lastSpawnedId = `uix-editor-spawn-${spawnCount}`;
      createUIWindow(world, {
        id: lastSpawnedId,
        title: `Live Panel ${spawnCount}`,
        config: compiled.configUrl,
        position: [
          SPAWN_POSITION[0] + (replaceLast ? 0 : (spawnCount - 1) * 0.12),
          SPAWN_POSITION[1],
          SPAWN_POSITION[2],
        ],
        maxWidth: 0.8,
        maxHeight: 0.9,
      });
      say(`Spawned "Live Panel ${spawnCount}" — drag, dock or edit again.`);
    };

    element('editor-spawn')?.addEventListener('click', () => spawn(false));
    element('editor-respawn')?.addEventListener('click', () => spawn(true));
    element('editor-reset')?.addEventListener('click', () => {
      source = STARTER_PANEL_SOURCE;
      element('editor-source')?.setProperties({ defaultValue: source });
      say('Reset to the starter panel.');
    });
  }
}
