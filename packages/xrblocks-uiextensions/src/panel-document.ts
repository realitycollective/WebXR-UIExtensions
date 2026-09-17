/**
 * UixPanelDocument - minimal spatial hosting for interpreted UIKitML on
 * plain three.js (the XR Blocks scene graph is plain three.js).
 *
 * Mirrors the behaviour of IWSDK's UIKitDocument where it matters to the
 * core: a `Group` wrapping the interpreted component tree, per-frame
 * `update`, scale-to-fit via {@link fitScale}, and `getElementById` backed
 * by the components' `userData.id` (where UIKitML places markup ids -
 * the same `userData` surface the core's `UixElement` contract reads).
 */
import { Group, type Object3D } from 'three';
import { interpret, type Kit } from '@pmndrs/uikitml';
import type { PanelHandle, UixElement } from '@realitycollective/webxr-uiextensions';
import { fitScale } from './scale-math.js';

/** The slice of a uikit component this adapter relies on. */
interface UikitComponentLike extends Object3D {
  update?(deltaMs: number): void;
  size?: {
    value: unknown;
    subscribe?(listener: () => void): () => void;
  };
  dispose?(): void;
}

function naturalSize(
  component: UikitComponentLike,
): [number | undefined, number | undefined] {
  const value = component.size?.value;
  if (Array.isArray(value) && value.length >= 2) {
    return [value[0] as number, value[1] as number];
  }
  return [undefined, undefined];
}

export class UixPanelDocument extends Group implements PanelHandle {
  readonly rootComponent: UikitComponentLike;
  private targetWidth = 1;
  private targetHeight = 1;
  private unsubscribeSize: (() => void) | undefined;

  constructor(configJson: unknown, kit?: Kit) {
    super();
    const component = interpret(
      configJson as Parameters<typeof interpret>[0],
      kit,
    );
    if (!component) {
      throw new Error('UIKitML config produced no interpretable root element.');
    }
    this.rootComponent = component as unknown as UikitComponentLike;
    this.add(this.rootComponent);
    // Re-fit whenever layout measures the panel (size arrives async).
    this.unsubscribeSize = this.rootComponent.size?.subscribe?.(() =>
      this.applyScale(),
    );
  }

  get root(): UixElement {
    return this.rootComponent as unknown as UixElement;
  }

  getElementById(id: string): UixElement | undefined {
    let found: UixElement | undefined;
    this.rootComponent.traverse((object: Object3D) => {
      if (!found && object.userData?.['id'] === id) {
        found = object as unknown as UixElement;
      }
    });
    return found;
  }

  setTargetDimensions(width: number, height: number): void {
    this.targetWidth = width;
    this.targetHeight = height;
    this.applyScale();
  }

  /** Drive per-frame - uikit expects milliseconds. */
  update(deltaSeconds: number): void {
    this.rootComponent.update?.(deltaSeconds * 1000);
  }

  dispose(): void {
    this.unsubscribeSize?.();
    this.unsubscribeSize = undefined;
    this.removeFromParent();
    this.rootComponent.dispose?.();
  }

  private applyScale(): void {
    const [naturalWidth, naturalHeight] = naturalSize(this.rootComponent);
    const scale = fitScale(
      this.targetWidth,
      this.targetHeight,
      naturalWidth,
      naturalHeight,
    );
    if (scale !== undefined) {
      this.scale.setScalar(scale);
    }
  }
}
