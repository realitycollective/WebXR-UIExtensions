/**
 * `CursorVisual` - `ui/pointer-cursor` for plain three.js: a disc at a ray's
 * current hit, oriented to the surface, offset off it per the core
 * `cursorPlacement` rule, shown and hidden by nothing but whether the ray
 * currently hits something.
 */
import { Group, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_CURSOR_OFFSET, type QuatTuple } from '@realitycollective/webxr-uiextensions';
import { CursorVisual } from '../src/cursor-visual.js';

const IDENTITY: QuatTuple = [0, 0, 0, 1];

describe('CursorVisual', () => {
  it('is added to its parent, hidden, until shown', () => {
    const parent = new Group();
    const cursor = new CursorVisual(parent);
    expect(parent.children).toContain(cursor.object);
    expect(cursor.object.visible).toBe(false);
  });

  it('showAtHit places the disc at the hit point, offset along the surface normal, facing it', () => {
    const cursor = new CursorVisual(new Group());
    cursor.showAtHit([0, 1.5, -1], [0, 0, 1], IDENTITY);
    expect(cursor.object.visible).toBe(true);
    expect(cursor.object.position.x).toBeCloseTo(0, 9);
    expect(cursor.object.position.y).toBeCloseTo(1.5, 9);
    expect(cursor.object.position.z).toBeCloseTo(-1 + DEFAULT_CURSOR_OFFSET, 9);
    // Facing the surface normal (+Z here): the disc's own +Z should read back as +Z.
    const v = new Vector3(0, 0, 1).applyQuaternion(cursor.object.quaternion);
    expect(v.x).toBeCloseTo(0, 5);
    expect(v.y).toBeCloseTo(0, 5);
    expect(v.z).toBeCloseTo(1, 5);
  });

  it('showAtHit with no surface normal falls back to the ray’s own orientation', () => {
    const cursor = new CursorVisual(new Group());
    const rayQuaternion: QuatTuple = [0, Math.SQRT1_2, 0, Math.SQRT1_2]; // 90deg yaw
    cursor.showAtHit([0, 0, 0], undefined, rayQuaternion);
    expect(cursor.object.visible).toBe(true);
    expect(cursor.object.quaternion.toArray()).toEqual(rayQuaternion);
    // The core rule's offset follows THAT orientation too (its local +Z -> world +X here).
    expect(cursor.object.position.x).toBeCloseTo(DEFAULT_CURSOR_OFFSET, 9);
    expect(cursor.object.position.z).toBeCloseTo(0, 9);
  });

  it('hide() hides a disc that was shown - a defect that left it visible would fail this', () => {
    const cursor = new CursorVisual(new Group());
    cursor.showAtHit([0, 0, -1], [0, 0, 1], IDENTITY);
    expect(cursor.object.visible).toBe(true);
    cursor.hide();
    expect(cursor.object.visible).toBe(false);
  });

  it('dispose() removes the disc from its parent', () => {
    const parent = new Group();
    const cursor = new CursorVisual(parent);
    cursor.dispose();
    expect(parent.children).toHaveLength(0);
  });

  it('accepts a custom radius and offset', () => {
    const cursor = new CursorVisual(new Group(), { radius: 0.02, offset: 0.01 });
    cursor.showAtHit([0, 0, 0], [0, 0, 1], IDENTITY);
    expect(cursor.object.position.z).toBeCloseTo(0.01, 9);
  });
});
