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

describe('native UI host conformance kit, hover', () => {
  const cases = nativeUiHostConformanceCases();
  const hover = cases.find((c) => c.name.includes('hover is decided by the binding'))!;

  it('fails a host with no setHover, or a test host with no readback', async () => {
    const setup = deviceLikeHost();
    const noStyle = { ...setup, ui: { ...setup.ui, setHover: undefined } as unknown as NativeUiHost };
    await expect(hover.run(noStyle)).rejects.toThrow(/no setHover/);
    const noRead = { ...setup, testHost: { ...setup.testHost, elementHovered: undefined } as unknown as typeof setup.testHost };
    await expect(hover.run(noRead)).rejects.toThrow(/no elementHovered or elementHandle readback/);
    const noTitle = deviceLikeHost();
    noTitle.testHost.elementHandle = () => undefined;
    await expect(hover.run(noTitle)).rejects.toThrow(/no title element/);
  });

  it('fails a host that ignores what it is told, either way', async () => {
    const setup = deviceLikeHost();
    const deaf = { ...setup, ui: { ...setup.ui, setHover: () => undefined } as NativeUiHost };
    await expect(hover.run(deaf)).rejects.toThrow(/does not/);
    const sticky = deviceLikeHost();
    const original = sticky.ui.setHover!.bind(sticky.ui);
    sticky.ui.setHover = (panelId, handle, hovered) => original(panelId, handle, hovered || true);
    await expect(hover.run(sticky)).rejects.toThrow(/keeps it/);
  });
});

describe('native UI host conformance kit, scrolling and text', () => {
  const cases = nativeUiHostConformanceCases();
  const scroll = cases.find((c) => c.name.includes('scrolls an element'))!;
  const keys = cases.find((c) => c.name.includes('shows its keyboard'))!;

  it('fails a host that cannot scroll, cannot be read, or draws elsewhere', async () => {
    const setup = deviceLikeHost();
    await expect(scroll.run({ ...setup, ui: { ...setup.ui, setScroll: undefined } as unknown as NativeUiHost })).rejects.toThrow(/no setScroll/);
    await expect(scroll.run({ ...setup, testHost: { ...setup.testHost, scrollPosition: undefined } as unknown as typeof setup.testHost })).rejects.toThrow(/no scrollPosition/);
    const deaf = deviceLikeHost();
    deaf.ui.setScroll = () => undefined;
    await expect(scroll.run(deaf)).rejects.toThrow(/draws it at/);
    const noContent = deviceLikeHost();
    noContent.testHost.elementHandle = () => undefined;
    await expect(scroll.run(noContent)).rejects.toThrow(/no content element/);
  });

  it('fails a host with no keyboard, no readback, or one that ignores what it is told', async () => {
    const setup = deviceLikeHost();
    await expect(keys.run({ ...setup, ui: { ...setup.ui, showKeyboard: undefined } as unknown as NativeUiHost })).rejects.toThrow(/no showKeyboard/);
    await expect(keys.run({ ...setup, testHost: { ...setup.testHost, keyboardShown: undefined } as unknown as typeof setup.testHost })).rejects.toThrow(/no keyboardShown/);
    const deaf = deviceLikeHost();
    deaf.ui.showKeyboard = () => undefined;
    await expect(keys.run(deaf)).rejects.toThrow(/the host shows/);
    const sticky = deviceLikeHost();
    sticky.ui.hideKeyboard = () => undefined;
    await expect(keys.run(sticky)).rejects.toThrow(/keeps it up/);
    const noTitle = deviceLikeHost();
    noTitle.testHost.elementHandle = () => undefined;
    await expect(keys.run(noTitle)).rejects.toThrow(/no title element/);
  });
});

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
