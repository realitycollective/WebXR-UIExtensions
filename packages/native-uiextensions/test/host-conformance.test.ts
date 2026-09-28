/**
 * The host conformance kit against the reference fake host. The fake
 * behaves as a correct host would, so every case must pass here; this is
 * the kit's smoke test, not its proof. The proof is the same cases on the
 * device against the real `ui` slice.
 */
import { WINDOW_CHROME_IDS } from '@realitycollective/webxr-uiextensions';
import { describe, expect, it } from 'vitest';
import { nativeUiHostConformanceCases } from '../src/index.js';
import type { NativeUiHost } from '../src/native-types.js';
import { createFakeNativeUiHost, type FakeElementSpec } from './helpers/fake-native-ui-host.js';

const CONFIG: FakeElementSpec = {
  id: WINDOW_CHROME_IDS.window,
  children: [
    {
      id: WINDOW_CHROME_IDS.titlebar,
      children: [
        { id: WINDOW_CHROME_IDS.title },
        { id: WINDOW_CHROME_IDS.pin },
        { id: WINDOW_CHROME_IDS.dock },
        { id: WINDOW_CHROME_IDS.minimize },
        { id: WINDOW_CHROME_IDS.close },
      ],
    },
    { id: WINDOW_CHROME_IDS.content },
  ],
};

/** A host that builds each window's panel when asked, as a device frame loop would. */
function deviceLikeHost() {
  const fake = createFakeNativeUiHost();
  const pending = new Map<string, unknown>();
  const ui: NativeUiHost = {
    ...fake,
    createWindow(windowId, config, options) {
      fake.createWindow(windowId, config, options);
      pending.set(windowId, config);
    },
  };
  return {
    ui,
    testHost: fake,
    config: CONFIG,
    async waitForPanel(windowId: string) {
      const config = pending.get(windowId) as FakeElementSpec | undefined;
      if (config) {
        pending.delete(windowId);
        fake.readyWindow(windowId, `panel-${windowId}`, config);
      }
    },
  };
}

describe('native UI host conformance kit, against the reference fake', () => {
  const cases = nativeUiHostConformanceCases();

  it('names every case after its master row', () => {
    expect(cases.length).toBeGreaterThanOrEqual(10);
    for (const hostCase of cases) expect(hostCase.name).toMatch(/^ui\//);
  });

  for (const hostCase of cases) {
    it(hostCase.name, () => hostCase.run(deviceLikeHost()));
  }

  it('fails, naming the row, when the host draws a window somewhere else', async () => {
    const setup = deviceLikeHost();
    const wrong = { ...setup, ui: { ...setup.ui, setWindowPose: () => {} } };
    const world = cases.find((c) => c.name.includes('pose it is handed'))!;
    await expect(world.run(wrong)).rejects.toThrow(/\[ui\/the host draws a window/);
  });

  it('fails when the host measures touch distance without a sign', async () => {
    const setup = deviceLikeHost();
    const unsigned = {
      ...setup,
      testHost: {
        ...setup.testHost,
        measureTouch: (id: string, point: [number, number, number]) => {
          const measured = setup.testHost.measureTouch(id, point);
          return measured && { ...measured, signedDistance: Math.abs(measured.signedDistance) };
        },
      },
    };
    const touch = cases.find((c) => c.name.includes('signed distance'))!;
    await expect(touch.run(unsigned)).rejects.toThrow(/1 cm behind/);
  });
});
