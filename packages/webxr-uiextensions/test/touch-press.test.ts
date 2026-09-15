import { describe, expect, it } from 'vitest';
import { DEFAULT_TOUCH_PRESS, TouchPress, resolveTouchPress } from '../src/core/touch-press.js';

const A = 'button-a';
const B = 'button-b';

/** Feed a sequence of signed distances over one target and collect transitions. */
function run(press: TouchPress<string>, distances: Array<number | undefined>, target = A) {
  return distances.map((d) =>
    press.update(d === undefined ? undefined : { signedDistance: d, target }),
  );
}

describe('touch press options', () => {
  it('fills defaults and rejects impossible thresholds', () => {
    expect(resolveTouchPress()).toEqual(DEFAULT_TOUCH_PRESS);
    expect(resolveTouchPress({ pressDistance: 0.01 })).toMatchObject({
      pressDistance: 0.01,
      releaseDistance: 0.03,
    });
    expect(() => resolveTouchPress({ pressDistance: -0.01 })).toThrow(/>= 0/);
    expect(() => resolveTouchPress({ pressDistance: 0.05, releaseDistance: 0.02 })).toThrow(
      /release distance/,
    );
    expect(new TouchPress().options).toEqual(DEFAULT_TOUCH_PRESS);
  });
});

describe('press, hold, release', () => {
  it('presses on entering the band from the front and releases past the release distance', () => {
    const press = new TouchPress<string>();
    const [far, near, touch] = run(press, [0.1, 0.05, 0.01]);
    expect(far!.phase).toBe('near');
    expect(near!.pressed).toBe(false);
    expect(touch).toMatchObject({ phase: 'pressed', pressed: true, pressTarget: A });
    expect(press.held).toBe(true);
    expect(press.target).toBe(A);
    const back = press.update({ signedDistance: 0.05, target: A });
    expect(back).toMatchObject({
      phase: 'near',
      released: true,
      pressTarget: A,
      releaseTarget: A,
      sameTarget: true,
    });
    expect(press.held).toBe(false);
  });

  it('a push through and back is ONE press and ONE release', () => {
    const press = new TouchPress<string>();
    const updates = run(press, [0.1, 0.01, -0.01, -0.05, -0.1, -0.05, -0.01, 0.01, 0.05]);
    const presses = updates.filter((u) => u.pressed).length;
    const releases = updates.filter((u) => u.released).length;
    expect(presses).toBe(1);
    expect(releases).toBe(1);
    // Every frame between is a hold, and the hold keeps its target.
    for (const u of updates.slice(2, 8)) {
      expect(u).toMatchObject({ phase: 'pressed', pressed: false, released: false, pressTarget: A });
    }
    expect(updates[8]!.released).toBe(true);
  });

  it('no second press can start until the release has happened', () => {
    const press = new TouchPress<string>();
    run(press, [0.1, 0.01]); // pressed
    // Deep behind, back into the band from behind, resting on the surface:
    // none of these are new presses.
    for (const d of [-0.2, -0.01, 0, 0.015, 0.025, 0.01]) {
      expect(press.update({ signedDistance: d, target: A })).toMatchObject({
        pressed: false,
        released: false,
        phase: 'pressed',
      });
    }
    expect(press.update({ signedDistance: 0.031, target: A }).released).toBe(true);
    // Now, and only now, a fresh approach presses again.
    expect(press.update({ signedDistance: 0.05, target: A }).pressed).toBe(false);
    expect(press.update({ signedDistance: 0.01, target: A }).pressed).toBe(true);
  });

  it('release has hysteresis: leaving the press band is not enough', () => {
    const press = new TouchPress<string>({ pressDistance: 0.02, releaseDistance: 0.04 });
    run(press, [0.1, 0.01]);
    expect(press.update({ signedDistance: 0.03, target: A }).released).toBe(false);
    expect(press.update({ signedDistance: 0.041, target: A }).released).toBe(true);
  });

  it('losing contact while held releases; losing it otherwise is quiet', () => {
    const press = new TouchPress<string>();
    run(press, [0.1, 0.01]);
    expect(press.update(undefined)).toMatchObject({
      phase: 'idle',
      released: true,
      pressTarget: A,
      releaseTarget: undefined,
      sameTarget: false,
    });
    expect(press.update(undefined)).toMatchObject({ phase: 'idle', released: false });
    expect(press.current).toBe('idle');
  });

  it('reset drops a hold silently', () => {
    const press = new TouchPress<string>();
    run(press, [0.1, 0.01]);
    press.reset();
    expect(press.held).toBe(false);
    expect(press.target).toBeUndefined();
    expect(press.update({ signedDistance: 0.05, target: A }).released).toBe(false);
  });
});

describe('arriving from behind', () => {
  it('never presses, and stays unarmed until seen in front', () => {
    const press = new TouchPress<string>();
    // First seen behind, then coming out through the band to the front.
    const updates = run(press, [-0.1, -0.01, 0.01, 0.025]);
    expect(updates.every((u) => !u.pressed)).toBe(true);
    expect(updates[3]!.phase).toBe('near');
    // Having been in front, the next entry presses.
    expect(press.update({ signedDistance: 0.01, target: A }).pressed).toBe(true);
  });

  it('a first sample within the band but in front counts as a front approach', () => {
    const press = new TouchPress<string>();
    expect(press.update({ signedDistance: 0.01, target: A }).pressed).toBe(true);
    const again = new TouchPress<string>();
    expect(again.update({ signedDistance: 0, target: A }).pressed).toBe(true);
    const behind = new TouchPress<string>();
    expect(behind.update({ signedDistance: -0.001, target: A }).pressed).toBe(false);
  });

  it('can be allowed explicitly', () => {
    const press = new TouchPress<string>({ allowFromBehind: true });
    expect(press.update({ signedDistance: -0.05, target: A }).pressed).toBe(true);
    // Still one press until released: coming out the front releases.
    expect(press.update({ signedDistance: 0.01, target: A }).pressed).toBe(false);
    expect(press.update({ signedDistance: 0.05, target: A }).released).toBe(true);
  });
});

describe('targets', () => {
  it('reports both ends when the finger enters one button and leaves another', () => {
    const press = new TouchPress<string>();
    press.update({ signedDistance: 0.1, target: A });
    expect(press.update({ signedDistance: 0.01, target: A }).pressTarget).toBe(A);
    // Sliding behind the panel onto the neighbour changes nothing yet.
    expect(press.update({ signedDistance: -0.01, target: B })).toMatchObject({
      phase: 'pressed',
      pressTarget: A,
    });
    expect(press.target).toBe(A);
    expect(press.update({ signedDistance: 0.05, target: B })).toMatchObject({
      released: true,
      pressTarget: A,
      releaseTarget: B,
      sameTarget: false,
    });
  });
});
