/**
 * UIPointerOfferSystem - tells the shared pointer arbiter which panels
 * IWSDK's pointers reach.
 *
 * IWSDK already arbitrates its own pointers: per hand the first of touch,
 * grab and ray with a hit owns the hand. This system gates nothing. Once per
 * frame, right after `InputSystem` has moved the pointers, it reads what each
 * of a hand's three pointers intersects and OFFERS the ones that sit under a
 * panel (a `PanelUI` entity's object, or any descendant) to the family's
 * `PanelPointerOffers`. The shared arbiter, and the visuals the Interactions
 * runtime publishes from it, then know about panels on IWSDK exactly as they
 * do on every other platform.
 *
 * Offers are keyed by the hand name ('left', 'right'), which the Interactions
 * runtime aliases to its own source ids. The panel id is the window id when
 * the entity is a managed window, else its `PanelUI` config path (the same id
 * the scene host announces), else the entity index. A kind with no panel hit
 * is offered as `undefined`. A pointer that is pressing (`getButtonsDown()`
 * not empty) sets the selection lock for that kind.
 */
import { PanelUI, type Entity, type World } from '@iwsdk/core';
import type { Object3D } from 'three';
import { createSystem } from '../create-system.js';
import { UIWindow } from '../components.js';
import {
  PanelPointerOffers,
  type Hand,
} from '@realitycollective/webxr-uiextensions';

/** The shared arbiter type, taken from the core so this package needs no direct dependency on it. */
export type PointerArbiterLike = NonNullable<ConstructorParameters<typeof PanelPointerOffers>[0]>;
type NearPointerKind = Parameters<PanelPointerOffers['offer']>[1];

const HANDS: readonly Hand[] = ['left', 'right'];
const KINDS: readonly NearPointerKind[] = ['touch', 'grab', 'ray'];

const offersByWorld = new WeakMap<World, PanelPointerOffers>();

/**
 * The `PanelPointerOffers` for a world: built on the first call (with
 * `pointers` when given, else an arbiter of its own) and the same instance
 * after. `registerUIExtensions(world, { pointers })` makes the first call.
 */
export function pointerOffersFor(world: World, pointers?: PointerArbiterLike): PanelPointerOffers {
  let offers = offersByWorld.get(world);
  if (!offers) {
    offers = new PanelPointerOffers(pointers);
    offersByWorld.set(world, offers);
  }
  return offers;
}

/** The slice of a pointer-events sub-pointer this system reads. */
interface OfferPointerLike {
  getIntersection():
    | { object: Object3D; point: { x: number; y: number; z: number }; distance: number }
    | undefined;
  getButtonsDown?(): ReadonlySet<number>;
}

export class UIPointerOfferSystem extends createSystem({
  panels: { required: [PanelUI] },
}) {
  private offers: PanelPointerOffers | undefined;

  override init(): void {
    this.offers = pointerOffersFor(this.world);
    const offers = this.offers;
    this.cleanupFuncs.push(() => {
      offers.dispose();
      offersByWorld.delete(this.world);
      this.offers = undefined;
    });
  }

  override update(): void {
    const offers = this.offers;
    const xr = (this.input as typeof this.input | undefined)?.xr;
    if (!offers || !xr) {
      return; // headless, or no XR input: nothing to offer
    }
    const roots = new Map<Object3D, Entity>();
    for (const entity of this.queries.panels.entities) {
      if (entity.object3D) {
        roots.set(entity.object3D, entity);
      }
    }
    for (const hand of HANDS) {
      const multi = xr.multiPointers[hand];
      for (const kind of KINDS) {
        const pointer = multi.getPointer(kind) as unknown as OfferPointerLike;
        const hit = pointer.getIntersection();
        const entity = hit ? panelOf(hit.object, roots) : undefined;
        offers.offer(
          hand,
          kind,
          hit && entity
            ? { panelId: panelIdOf(entity), point: [hit.point.x, hit.point.y, hit.point.z], distance: hit.distance }
            : undefined,
        );
        offers.setSelecting(hand, kind, (pointer.getButtonsDown?.().size ?? 0) > 0);
      }
      offers.resolve(hand);
    }
  }
}

/** The panel entity whose root is `object` or one of its ancestors. */
function panelOf(object: Object3D, roots: ReadonlyMap<Object3D, Entity>): Entity | undefined {
  for (let node: Object3D | null = object; node; node = node.parent) {
    const entity = roots.get(node);
    if (entity) {
      return entity;
    }
  }
  return undefined;
}

/** Window id, else config path, else entity index: the scene host's naming. */
function panelIdOf(entity: Entity): string {
  const windowId = entity.hasComponent(UIWindow)
    ? (UIWindow.data.windowId[entity.index] as string)
    : '';
  return windowId || (PanelUI.data.config[entity.index] as string) || String(entity.index);
}
