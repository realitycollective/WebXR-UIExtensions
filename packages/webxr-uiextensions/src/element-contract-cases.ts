/**
 * The shared `UixElement` contract, shipped as data rather than as tests.
 *
 * The core's controls (`<uix-stepper>`, `<uix-toggle>` and the rest) never
 * see a platform. They walk a panel's elements through `UixElement`: its
 * `children`, its `userData`, `setProperties` and `addEventListener`. uikit
 * implements that on the web platforms, and native implements it with proxy
 * elements over the native app's own. A control only behaves the same on
 * every platform if every one builds the same elements from the same markup,
 * so these cases check that, ending with a real stepper driven by clicks.
 *
 * Every subject builds its tree from {@link CONTRACT_PANEL_MARKUP}, however
 * the platform turns markup into elements. The suite is runner-free, like
 * `windowHostContractCases()`: each case returns on success and throws a
 * plain `Error` otherwise.
 *
 * ```ts
 * for (const contractCase of uixElementContractCases()) {
 *   it(contractCase.name, () => contractCase.run(makeSubject()));
 * }
 * ```
 */
import { attrNumber, attrString, findRole, tagOf, type UixElement } from './controls/element.js';
import { upgradePanel } from './controls/upgrade.js';

/**
 * The panel every subject builds. It uses only tags every platform's parser
 * accepts: IWSDK's rejects `<text>`, so the plain element is a `<span>`.
 */
export const CONTRACT_PANEL_MARKUP = `<div>
  <uix-stepper data-uix-id="contract-count" data-uix-min="0" data-uix-max="3" data-uix-step="1" data-uix-value="2" data-uix-chars-per-line="4">
    <uix-decrement>-</uix-decrement>
    <uix-value>.</uix-value>
    <uix-increment>+</uix-increment>
  </uix-stepper>
  <span>plain</span>
</div>`;

/** How a case observes and pokes the platform's real elements. */
export interface UixElementContractDriver {
  /** The value of `property` the platform is showing for `element` now. */
  rendered(element: UixElement, property: string): unknown;
  /** Deliver a user event of `type` to `element`, the way the platform does. */
  fire(element: UixElement, type: string): void;
}

/** A panel built from {@link CONTRACT_PANEL_MARKUP}. Build a FRESH one per case. */
export interface UixElementContractSubject {
  root: UixElement;
  drive: UixElementContractDriver;
}

/** One check a platform's `UixElement`s must pass. */
export interface UixElementContractCase {
  name: string;
  run(subject: UixElementContractSubject): void;
}

function assert(condition: boolean, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function stepperOf(root: UixElement): UixElement {
  const stepper = findRole(root, 'stepper');
  assert(stepper !== undefined, 'the panel must hold a <uix-stepper> readable through tagOf');
  return stepper;
}

function partOf(root: UixElement, role: string): UixElement {
  const part = findRole(root, role);
  assert(part !== undefined, `the panel must hold a <uix-${role}> readable through tagOf`);
  return part;
}

const CASES: readonly UixElementContractCase[] = [
  {
    name: 'children mirror the markup, in order',
    run({ root }) {
      assert(root.children.length === 2, `the panel root must have 2 children, got ${String(root.children.length)}`);
      const parts = stepperOf(root).children.map((child) => tagOf(child));
      assert(
        parts.join(',') === 'uix-decrement,uix-value,uix-increment',
        `the stepper's children must be decrement, value, increment in order, got [${parts.join(', ')}]`,
      );
    },
  },
  {
    name: 'tagOf reads a declared uix-* tag and nothing for a built-in one',
    run({ root }) {
      const [first, second] = root.children;
      assert(first !== undefined && second !== undefined, 'the panel root must have 2 children');
      assert(tagOf(first) === 'uix-stepper', `tagOf must read "uix-stepper", got ${JSON.stringify(tagOf(first))}`);
      assert(tagOf(second) === undefined, `tagOf must read nothing for a <span>, got ${JSON.stringify(tagOf(second))}`);
    },
  },
  {
    name: 'data-uix-* attributes arrive in userData, camelCased',
    run({ root }) {
      const stepper = stepperOf(root);
      const id = attrString(stepper, 'uixId');
      assert(id === 'contract-count', `data-uix-id must read as userData.uixId "contract-count", got ${JSON.stringify(id)}`);
      const max = attrNumber(stepper, 'uixMax');
      assert(max === 3, `data-uix-max must read as userData.uixMax 3, got ${JSON.stringify(max)}`);
      const chars = attrNumber(stepper, 'uixCharsPerLine');
      assert(chars === 4, `data-uix-chars-per-line must read as userData.uixCharsPerLine 4, got ${JSON.stringify(chars)}`);
    },
  },
  {
    name: 'setProperties reaches what the platform shows',
    run({ root, drive }) {
      const value = partOf(root, 'value');
      value.setProperties({ text: 'contract' });
      const shown = drive.rendered(value, 'text');
      assert(shown === 'contract', `setProperties({ text }) must be what the platform shows, got ${JSON.stringify(shown)}`);
    },
  },
  {
    name: 'a user event reaches every listener on that element and no other',
    run({ root, drive }) {
      const increment = partOf(root, 'increment');
      const decrement = partOf(root, 'decrement');
      let first = 0;
      let second = 0;
      let other = 0;
      increment.addEventListener('click', () => (first += 1));
      increment.addEventListener('click', () => (second += 1));
      decrement.addEventListener('click', () => (other += 1));
      drive.fire(increment, 'click');
      assert(first === 1 && second === 1, `one click must reach both listeners once, got ${String(first)} and ${String(second)}`);
      assert(other === 0, `a click on one element must not reach another's listener, got ${String(other)}`);
    },
  },
  {
    name: 'a core stepper upgrades from the markup and follows clicks',
    run({ root, drive }) {
      const controls = upgradePanel({}, root);
      const stepper = controls.get('contract-count');
      assert(stepper !== undefined, `upgradePanel must register the stepper as "contract-count", got [${controls.ids().join(', ')}]`);
      const value = partOf(root, 'value');
      const increment = partOf(root, 'increment');
      const shownAtStart = drive.rendered(value, 'text');
      assert(shownAtStart === '2', `the stepper must start at data-uix-value 2, showing ${JSON.stringify(shownAtStart)}`);
      drive.fire(increment, 'click');
      drive.fire(increment, 'click');
      const shown = drive.rendered(value, 'text');
      assert(shown === '3', `two increments from 2 must stop at data-uix-max 3, showing ${JSON.stringify(shown)}`);
      const opacity = drive.rendered(increment, 'opacity');
      assert(typeof opacity === 'number' && opacity < 1, `the increment must dim at the maximum, opacity ${JSON.stringify(opacity)}`);
    },
  },
];

/** The shared `UixElement` conformance suite. */
export function uixElementContractCases(): readonly UixElementContractCase[] {
  return CASES;
}
