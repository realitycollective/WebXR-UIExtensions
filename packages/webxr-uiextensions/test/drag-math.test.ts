import { describe, expect, it } from 'vitest';
import { beginDrag, dragPosition, faceViewerYaw, normalize } from '../src/core/drag-math.js';

describe('drag-math', () => {
  it('normalize scales to unit length and rejects zero vectors', () => {
    const unit = normalize([3, 0, 4]);
    expect(unit[0]).toBeCloseTo(0.6, 12);
    expect(unit[1]).toBe(0);
    expect(unit[2]).toBeCloseTo(0.8, 12);
    expect(() => normalize([0, 0, 0])).toThrow(/zero-length/);
  });

  it('captures grab distance and hold offset at drag start', () => {
    const session = beginDrag(
      [0, 0, 0], // ray origin
      [0, 0, -2], // grab point 2m ahead
      [0.1, 0.3, -2], // window origin slightly off the grab point
    );
    expect(session.distance).toBe(2);
    expect(session.holdOffset).toEqual([0.1, 0.3, 0]);
  });

  it('rides the ray at the captured distance, preserving the hold offset', () => {
    const session = beginDrag([0, 0, 0], [0, 0, -2], [0, 0.2, -2]);
    // Ray swings 90° to point down +X.
    const position = dragPosition(session, [0, 0, 0], [1, 0, 0]);
    expect(position).toEqual([2, 0.2, 0]);
  });

  it('follows a moving ray origin', () => {
    const session = beginDrag([0, 1, 0], [0, 1, -1], [0, 1, -1]);
    const position = dragPosition(session, [3, 1, 0], [0, 0, -1]);
    expect(position).toEqual([3, 1, -1]);
  });

  describe('faceViewerYaw', () => {
    it('yaws +Z toward the viewer', () => {
      // Viewer due +Z of the window → yaw 0.
      expect(faceViewerYaw([0, 0, 0], [0, 0, 5], 9)).toBe(0);
      // Viewer due +X → yaw 90°.
      expect(faceViewerYaw([0, 0, 0], [5, 0, 0], 0)).toBeCloseTo(Math.PI / 2);
      // Viewer due -Z → yaw 180°.
      expect(Math.abs(faceViewerYaw([0, 0, 0], [0, 0, -5], 0))).toBeCloseTo(Math.PI);
    });

    it('keeps the current yaw when the viewer is directly above', () => {
      expect(faceViewerYaw([1, 0, 1], [1, 5, 1], 0.7)).toBe(0.7);
    });

    it('ignores height differences (pivot-Y)', () => {
      expect(faceViewerYaw([0, 0, 0], [0, 3, 5], 9)).toBe(0);
    });
  });
});
