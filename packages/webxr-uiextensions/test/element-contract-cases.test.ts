/**
 * The shipped `UixElement` suite: a conforming element tree passes it, and
 * every case fails for a tree built to break the promise it checks.
 */
import { describe, expect, it } from 'vitest';
import {
  dataAttributeKey,
  tagOf,
  uixElementContractCases,
  type UixElement,
  type UixElementContractSubject,
} from '../src/index.js';

type Defect =
  | 'reorders'
  | 'untagged'
  | 'drops-attributes'
  | 'no-render'
  | 'first-listener-only'
  | 'broadcasts';

interface Spec {
  tag?: string;
  attributes?: Record<string, string>;
  children?: Spec[];
}

/** The contract panel, as a parser would hand it over. */
const PANEL: Spec = {
  tag: 'div',
  children: [
    {
      tag: 'uix-stepper',
      attributes: {
        'data-uix-id': 'contract-count',
        'data-uix-min': '0',
        'data-uix-max': '3',
        'data-uix-step': '1',
        'data-uix-value': '2',
        'data-uix-chars-per-line': '4',
      },
      children: [{ tag: 'uix-decrement' }, { tag: 'uix-value' }, { tag: 'uix-increment' }],
    },
    { tag: 'span' },
  ],
};

class FakeElement implements UixElement {
  readonly userData: Record<string, unknown> = {};
  readonly children: FakeElement[];
  readonly shown: Record<string, unknown> = {};
  readonly listeners = new Map<string, Array<(event?: unknown) => void>>();

  constructor(spec: Spec, private readonly world: FakeElement[], private readonly defect?: Defect) {
    world.push(this);
    const custom = spec.tag !== undefined && spec.tag.includes('-');
    if (custom && defect !== 'untagged') {
      this.userData['customElement'] = { componentName: spec.tag };
    }
    if (defect !== 'drops-attributes') {
      for (const [key, value] of Object.entries(spec.attributes ?? {})) {
        this.userData[dataAttributeKey(key)] = value;
      }
    }
    const children = (spec.children ?? []).map((child) => new FakeElement(child, world, defect));
    this.children = defect === 'reorders' ? children.reverse() : children;
  }

  addEventListener(type: string, listener: (event?: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  setProperties(props: Record<string, unknown>): void {
    if (this.defect !== 'no-render') Object.assign(this.shown, props);
  }

  fire(type: string): void {
    const targets = this.defect === 'broadcasts' ? this.world : [this];
    for (const target of targets) {
      const list = target.listeners.get(type) ?? [];
      for (const listener of this.defect === 'first-listener-only' ? list.slice(0, 1) : list) listener();
    }
  }
}

function makeSubject(defect?: Defect): UixElementContractSubject {
  const root = new FakeElement(PANEL, [], defect);
  return {
    root,
    drive: {
      rendered: (element, property) => (element as FakeElement).shown[property],
      fire: (element, type) => (element as FakeElement).fire(type),
    },
  };
}

function runCase(name: string, subject: UixElementContractSubject): void {
  const contractCase = uixElementContractCases().find((entry) => entry.name === name);
  if (!contractCase) throw new Error(`no contract case named "${name}"`);
  contractCase.run(subject);
}

describe('uixElementContractCases', () => {
  it('ships named cases, each with a run function, as the same data every call', () => {
    const cases = uixElementContractCases();
    expect(cases.length).toBe(6);
    expect(uixElementContractCases()).toBe(cases);
  });

  it('passes a conforming element tree', () => {
    for (const contractCase of uixElementContractCases()) {
      expect(() => contractCase.run(makeSubject())).not.toThrow();
    }
  });
});

describe('uixElementContractCases catches a broken platform', () => {
  it('rejects children out of markup order', () => {
    expect(() => runCase('children mirror the markup, in order', makeSubject('reorders'))).toThrow(/decrement, value, increment in order/);
  });

  it('rejects a tree whose uix-* tags cannot be read', () => {
    expect(() => runCase('children mirror the markup, in order', makeSubject('untagged'))).toThrow(/<uix-stepper> readable through tagOf/);
    expect(() => runCase('tagOf reads a declared uix-* tag and nothing for a built-in one', makeSubject('untagged'))).toThrow(
      /tagOf must read "uix-stepper"/,
    );
  });

  it('rejects a plain element that reads as a custom one', () => {
    const subject = makeSubject();
    const span = subject.root.children[1] as FakeElement;
    // tagOf ignores a recorded built-in name such as "span", so only a hyphenated one can fail.
    span.userData['customElement'] = { componentName: 'x-span' };
    expect(tagOf(span)).toBe('x-span');
    expect(() => runCase('tagOf reads a declared uix-* tag and nothing for a built-in one', subject)).toThrow(/nothing for a <span>/);
  });

  it('rejects a tree that drops the data-uix-* attributes', () => {
    expect(() => runCase('data-uix-* attributes arrive in userData, camelCased', makeSubject('drops-attributes'))).toThrow(
      /userData.uixId "contract-count", got undefined/,
    );
    expect(() => runCase('a core stepper upgrades from the markup and follows clicks', makeSubject('drops-attributes'))).toThrow(
      /register the stepper as "contract-count"/,
    );
  });

  it('rejects a setProperties that never reaches the screen', () => {
    expect(() => runCase('setProperties reaches what the platform shows', makeSubject('no-render'))).toThrow(/must be what the platform shows/);
    expect(() => runCase('a core stepper upgrades from the markup and follows clicks', makeSubject('no-render'))).toThrow(
      /must start at data-uix-value 2/,
    );
  });

  it('rejects an event that reaches only the first listener, or every element', () => {
    expect(() =>
      runCase('a user event reaches every listener on that element and no other', makeSubject('first-listener-only')),
    ).toThrow(/reach both listeners once/);
    expect(() => runCase('a user event reaches every listener on that element and no other', makeSubject('broadcasts'))).toThrow(
      /must not reach another's listener/,
    );
  });

  it('fails loudly when asked for a case that does not exist', () => {
    expect(() => runCase('no such case', makeSubject())).toThrow(/no contract case named/);
  });
});
