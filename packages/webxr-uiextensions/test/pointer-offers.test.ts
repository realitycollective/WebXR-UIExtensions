import { describe, expect, it } from 'vitest';
import { PointerArbiter, PointerDisplay } from '@realitycollective/webxr-input';
import { PanelPointerOffers, UIX_POINTER_SET } from '../src/index.js';

describe('PanelPointerOffers', () => {
  it('on its own, owns every source it offers for', () => {
    const offers = new PanelPointerOffers();
    expect(offers.ownArbiter).toBe(true);
    offers.offer('right', 'ray', { panelId: 'info', point: [0, 1, -1], distance: 1 });
    offers.resolve('right');
    expect(offers.owns('right', 'ray')).toBe(true);
    expect(offers.owns('right', 'touch')).toBe(false);
    offers.forget('right');
    expect(offers.arbiter.decision('right')).toBeUndefined();
  });

  it('shares the app arbiter: an object touch nearer than the panel takes the source, and a panel touch takes it from an object ray', () => {
    const arbiter = new PointerArbiter();
    const objects = arbiter.registerSet('interactions', 'object');
    const offers = new PanelPointerOffers(arbiter);
    expect(offers.ownArbiter).toBe(false);
    expect(arbiter.getSets().map((set) => set.id)).toEqual(['interactions', UIX_POINTER_SET]);
    arbiter.alias('right', 'right-input');
    offers.offer('right', 'ray', { panelId: 'info', point: [0, 1, -1], distance: 1 });
    objects.offer('right-input', 'touch', { targetId: 'button', point: [0.3, 1, -0.4], distance: 0.01 });
    offers.resolve('right');
    expect(offers.owns('right', 'ray')).toBe(false);
    objects.offer('right-input', 'touch', null);
    objects.offer('right-input', 'ray', { targetId: 'ball', point: [0, 1, -2], distance: 2 });
    offers.offer('right', 'touch', { panelId: 'info', point: [0, 1, -1], distance: 0.01 });
    const decision = offers.resolve('right');
    expect(decision.active).toBe('touch');
    expect(decision.candidate?.set).toBe(UIX_POINTER_SET);
    expect(offers.owns('right', 'touch')).toBe(true);
    // The lock: pressing on the panel keeps the source while an object grab appears.
    offers.setSelecting('right', 'touch', true);
    objects.offer('right-input', 'grab', { targetId: 'ball', point: [0, 1, -1], distance: 0 });
    expect(offers.resolve('right').active).toBe('touch');
    offers.setSelecting('right', 'touch', false);
    offers.offer('right', 'touch', undefined);
    expect(offers.resolve('right').active).toBe('grab');
    // Forgetting a source on a shared arbiter drops this host's offers only.
    offers.forget('right');
    expect(arbiter.resolve('right').active).toBe('grab');
  });

  it('presents a source: the arbiter visuals through the app pointer display, the cursor on the panel', () => {
    const offers = new PanelPointerOffers();
    const display = new PointerDisplay();
    offers.offer('right', 'ray', { panelId: 'info', point: [0, 1, -1], distance: 1 });
    offers.resolve('right');
    const shown = offers.present('right', true, false, display);
    expect(shown).toMatchObject({ sourceId: 'right', ray: true, cursor: true, cursorPoint: [0, 1, -1], activePointer: 'ray', targetKind: 'panel', targetId: 'info', hitDistance: 1 });
    expect(shown.rayColor).toEqual([...display.get().rayColor]);
    // The drawing is a copy: changing it never reaches the settings.
    expect(shown.rayColor).not.toBe(display.get().rayColor);
    // Pressing: the selected look.
    const pressed = offers.present('right', true, true, display);
    expect(pressed.rayColor).toEqual([...display.get().raySelectedColor]);
    expect(pressed.cursorOpacity).toBe(display.get().cursorSelectedOpacity);
    // Nothing reached: no cursor, and under the default setting no ray either.
    offers.offer('right', 'ray', undefined);
    offers.resolve('right');
    expect(offers.present('right', true, false, display)).toMatchObject({ ray: false, cursor: false, cursorPoint: null, activePointer: null, targetKind: null, targetId: null, hitDistance: null });
    // The app's settings decide: "always" draws a ray that hits nothing, and a source with no ray never has one.
    display.set({ ray: 'always' });
    expect(offers.present('right', true, false, display).ray).toBe(true);
    expect(offers.present('right', false, false, display).ray).toBe(false);
  });

  it('does nothing after dispose', () => {
    const arbiter = new PointerArbiter();
    const offers = new PanelPointerOffers(arbiter);
    offers.dispose();
    offers.dispose();
    offers.offer('left', 'ray', { panelId: 'p', point: [0, 0, 0], distance: 1 });
    offers.setSelecting('left', 'ray', true);
    offers.forget('left');
    expect(offers.owns('left', 'ray')).toBe(false);
    expect(arbiter.getSets()).toEqual([]);
  });
});
