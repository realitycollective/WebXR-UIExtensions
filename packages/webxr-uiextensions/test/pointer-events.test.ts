import { describe, expect, it } from 'vitest';
import { EdgePress, dispatchTouchUpdate, type PointerEventSink, type PointerEventType } from '../src/core/pointer-events.js';
import { TouchPress } from '../src/core/touch-press.js';

function recorder(): PointerEventSink<string> & { events: Array<[PointerEventType, string]> } {
  const events: Array<[PointerEventType, string]> = [];
  return {
    events,
    dispatch(type, target) {
      events.push([type, target]);
    },
  };
}

const same = (a: string, b: string) => a === b;

describe('dispatchTouchUpdate', () => {
  it('turns a press into pointerdown', () => {
    const touch = new TouchPress<string>();
    const sink = recorder();
    dispatchTouchUpdate(touch.update({ signedDistance: 0.01, target: 'body' }), sink, same);
    expect(sink.events).toEqual([['pointerdown', 'body']]);
  });

  it('turns a release on the same target into pointerup then click', () => {
    const touch = new TouchPress<string>();
    touch.update({ signedDistance: 0.01, target: 'body' });
    const sink = recorder();
    dispatchTouchUpdate(touch.update({ signedDistance: 0.031, target: 'body' }), sink, same);
    expect(sink.events).toEqual([
      ['pointerup', 'body'],
      ['click', 'body'],
    ]);
  });

  it('a release over a different target is pointerup with no click', () => {
    const touch = new TouchPress<string>();
    touch.update({ signedDistance: 0.01, target: 'a' });
    const sink = recorder();
    dispatchTouchUpdate(touch.update({ signedDistance: 0.031, target: 'b' }), sink, same);
    expect(sink.events).toEqual([['pointerup', 'b']]);
  });

  it('contact lost mid-press ends it at the press target, with no click', () => {
    const touch = new TouchPress<string>();
    touch.update({ signedDistance: 0.01, target: 'body' });
    const sink = recorder();
    dispatchTouchUpdate(touch.update(undefined), sink, same);
    expect(sink.events).toEqual([['pointerup', 'body']]);
  });

  it('a release update with neither target dispatches nothing (defensive; TouchPress never produces this)', () => {
    const sink = recorder();
    dispatchTouchUpdate(
      { phase: 'idle', pressed: false, released: true, pressTarget: undefined, releaseTarget: undefined, sameTarget: false },
      sink,
      same,
    );
    expect(sink.events).toEqual([]);
  });

  it('compares targets with isSameTarget, not object identity: a fresh wrapper for the same element still clicks', () => {
    // Mirrors a real binding: `resolveTarget` builds a NEW { panel, element }
    // wrapper every call, so two wrappers for the same element are never
    // `===` even though `TouchUpdate.sameTarget` would say they differ.
    interface Wrapper {
      element: string;
    }
    const touch = new TouchPress<Wrapper>();
    const sink: PointerEventSink<Wrapper> & { events: Array<[PointerEventType, Wrapper]> } = {
      events: [],
      dispatch(type, target) {
        this.events.push([type, target]);
      },
    };
    const byElement = (element: string): Wrapper => ({ element }); // a fresh object every call
    const sameElement = (a: Wrapper, b: Wrapper) => a.element === b.element;
    touch.update({ signedDistance: 0.01, target: byElement('body') });
    dispatchTouchUpdate(touch.update({ signedDistance: 0.031, target: byElement('body') }), sink, sameElement);
    expect(sink.events.map(([type]) => type)).toEqual(['pointerup', 'click']);
  });

  it('a quiet frame (no press, no release) dispatches nothing', () => {
    const touch = new TouchPress<string>();
    const sink = recorder();
    dispatchTouchUpdate(touch.update({ signedDistance: 0.05, target: 'body' }), sink, same);
    expect(sink.events).toEqual([]);
  });
});

describe('EdgePress', () => {
  it('presses on the rising edge over a target', () => {
    const edge = new EdgePress<string>();
    const sink = recorder();
    edge.update(true, 'body', sink, same);
    expect(sink.events).toEqual([['pointerdown', 'body']]);
    expect(edge.isPressed).toBe(true);
    expect(edge.target).toBe('body');
  });

  it('does nothing on the rising edge with no target under the pointer', () => {
    const edge = new EdgePress<string>();
    const sink = recorder();
    edge.update(true, undefined, sink, same);
    expect(sink.events).toEqual([]);
    expect(edge.isPressed).toBe(false);
  });

  it('releases with a click when the falling edge is over the same target', () => {
    const edge = new EdgePress<string>();
    const sink = recorder();
    edge.update(true, 'body', sink, same);
    edge.update(false, 'body', sink, same);
    expect(sink.events).toEqual([
      ['pointerdown', 'body'],
      ['pointerup', 'body'],
      ['click', 'body'],
    ]);
    expect(edge.isPressed).toBe(false);
  });

  it('releases with no click when the falling edge lands on a different target', () => {
    const edge = new EdgePress<string>();
    const sink = recorder();
    edge.update(true, 'a', sink, same);
    edge.update(false, 'b', sink, same);
    expect(sink.events).toEqual([
      ['pointerdown', 'a'],
      ['pointerup', 'b'],
    ]);
  });

  it('losing the target mid-press still releases, at the press target, with no click', () => {
    const edge = new EdgePress<string>();
    const sink = recorder();
    edge.update(true, 'a', sink, same);
    edge.update(true, undefined, sink, same); // moved off target while still active
    edge.update(false, undefined, sink, same);
    expect(sink.events).toEqual([
      ['pointerdown', 'a'],
      ['pointerup', 'a'],
    ]);
  });

  it('a falling edge with nothing pressed does nothing (no press ever started)', () => {
    const edge = new EdgePress<string>();
    const sink = recorder();
    edge.update(false, 'a', sink, same);
    expect(sink.events).toEqual([]);
  });

  it('staying active does not re-press or re-release', () => {
    const edge = new EdgePress<string>();
    const sink = recorder();
    edge.update(true, 'a', sink, same);
    edge.update(true, 'a', sink, same);
    edge.update(true, 'a', sink, same);
    expect(sink.events).toEqual([['pointerdown', 'a']]);
  });
});
