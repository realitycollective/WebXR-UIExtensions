import { describe, expect, it, vi } from 'vitest';
import type { UixElement } from '../src/controls/element.js';
import { attrBoolean, attrNumber, findRole, walk } from '../src/controls/element.js';
import { StepperHandle } from '../src/controls/stepper.js';
import { ToggleHandle } from '../src/controls/toggle.js';
import { ExpandableLabelHandle } from '../src/controls/expandable-label.js';
import { LogViewHandle } from '../src/controls/log-view.js';
import { panelControlsFor, upgradePanel } from '../src/controls/upgrade.js';

/** Minimal stand-in for a uikit element tree. */
class FakeElement implements UixElement {
  userData: Record<string, unknown>;
  children: FakeElement[] = [];
  props: Record<string, unknown> = {};
  private listeners = new Map<string, Array<(event?: unknown) => void>>();

  constructor(userData: Record<string, unknown> = {}) {
    this.userData = userData;
  }

  add(child: FakeElement): FakeElement {
    this.children.push(child);
    return this;
  }

  addEventListener(type: string, listener: (event?: unknown) => void): void {
    const list = this.listeners.get(type) ?? [];
    list.push(listener);
    this.listeners.set(type, list);
  }

  setProperties(props: Record<string, unknown>): void {
    Object.assign(this.props, props);
  }

  fire(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener();
    }
  }
}

function stepperMarkup(attrs: Record<string, unknown> = {}): FakeElement {
  const root = new FakeElement({ uix: 'stepper', uixId: 'count', ...attrs });
  root
    .add(new FakeElement({ uixRole: 'decrement' }))
    .add(new FakeElement({ uixRole: 'value' }))
    .add(new FakeElement({ uixRole: 'increment' }));
  return root;
}

describe('element helpers', () => {
  it('walks depth-first and finds roles at any depth', () => {
    const root = new FakeElement();
    const wrapper = new FakeElement();
    const deep = new FakeElement({ uixRole: 'value' });
    wrapper.add(deep);
    root.add(wrapper);
    const seen: UixElement[] = [];
    walk(root, (element) => seen.push(element));
    expect(seen).toHaveLength(3);
    expect(findRole(root, 'value')).toBe(deep);
    expect(findRole(root, 'missing')).toBeUndefined();
  });

  it('parses numeric and boolean attributes defensively', () => {
    const element = new FakeElement({ n: '4.5', junk: 'abc', on: 'true', off: '0', empty: '' });
    expect(attrNumber(element, 'n')).toBe(4.5);
    expect(attrNumber(element, 'junk')).toBeUndefined();
    expect(attrNumber(element, 'missing')).toBeUndefined();
    expect(attrBoolean(element, 'on')).toBe(true);
    expect(attrBoolean(element, 'off')).toBe(false);
    expect(attrBoolean(element, 'empty')).toBeUndefined();
  });
});

describe('upgradePanel', () => {
  it('discovers and wires controls by data-uix marker', () => {
    const doc = {};
    const root = new FakeElement();
    root.add(stepperMarkup({ uixMin: '0', uixMax: '3', uixValue: '1' }));
    const toggle = new FakeElement({ uix: 'toggle', uixId: 'shield', uixOn: 'true' });
    toggle.add(new FakeElement({ uixRole: 'label' }));
    root.add(toggle);

    const controls = upgradePanel(doc, root);
    expect(controls.ids().sort()).toEqual(['count', 'shield']);
    expect(controls.stepper('count').value).toBe(1);
    expect(controls.toggle('shield').value).toBe(true);
    expect(panelControlsFor(doc)).toBe(controls);
  });

  it('is idempotent per document key', () => {
    const doc = {};
    const root = new FakeElement();
    root.add(stepperMarkup());
    const first = upgradePanel(doc, root);
    const second = upgradePanel(doc, root);
    expect(second).toBe(first);
  });

  it('skips unknown markers with a warning and auto-ids anonymous controls', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const doc = {};
    const root = new FakeElement();
    root.add(new FakeElement({ uix: 'flux-capacitor' }));
    const anonymous = new FakeElement({ uix: 'toggle' });
    root.add(anonymous);
    const controls = upgradePanel(doc, root);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('flux-capacitor'));
    expect(controls.ids()).toEqual(['uix-control-0']);
    warn.mockRestore();
  });

  it('typed accessors reject wrong ids and wrong kinds', () => {
    const doc = {};
    const root = new FakeElement();
    root.add(stepperMarkup());
    const controls = upgradePanel(doc, root);
    expect(() => controls.toggle('count')).toThrow(/not a ToggleHandle/);
    expect(() => controls.stepper('ghost')).toThrow(/no control "ghost"/);
    expect(controls.get('count')).toBeInstanceOf(StepperHandle);
    expect(controls.get('ghost')).toBeUndefined();
  });

  it('rejects duplicate control ids', () => {
    const doc = {};
    const root = new FakeElement();
    root.add(stepperMarkup()).add(stepperMarkup());
    expect(() => upgradePanel(doc, root)).toThrow(/duplicate control id/);
  });
});

describe('stepper control', () => {
  it('clicks step the value, render disables at bounds, events fire', () => {
    const root = stepperMarkup({ uixMin: '0', uixMax: '2', uixStep: '1', uixValue: '1' });
    const controls = upgradePanel({}, root);
    const handle = controls.stepper('count');
    const heard: number[] = [];
    handle.events.on('change', (value) => heard.push(value));

    const [decrement, value, increment] = root.children as FakeElement[];
    expect(value!.props['text']).toBe('1');

    increment!.fire('click');
    expect(handle.value).toBe(2);
    expect(value!.props['text']).toBe('2');
    expect(increment!.props['opacity']).toBeLessThan(1);

    increment!.fire('click'); // clamped — no event
    expect(heard).toEqual([2]);

    decrement!.fire('click');
    decrement!.fire('click');
    expect(handle.value).toBe(0);
    expect(decrement!.props['opacity']).toBeLessThan(1);
    expect(heard).toEqual([2, 1, 0]);
  });
});

describe('toggle control', () => {
  it('click toggles, writes label text and colors, fires change', () => {
    const root = new FakeElement({
      uix: 'toggle',
      uixId: 'shield',
      uixOnText: 'SHIELD ON',
      uixOffText: 'SHIELD OFF',
      uixOnColor: '#00ff00',
      uixOffColor: '#333333',
    });
    const label = new FakeElement({ uixRole: 'label' });
    root.add(label);
    const handle = upgradePanel({}, wrap(root)).toggle('shield');
    expect(handle).toBeInstanceOf(ToggleHandle);
    expect(label.props['text']).toBe('SHIELD OFF');
    expect(root.props['backgroundColor']).toBe('#333333');

    const heard: boolean[] = [];
    handle.events.on('change', (value) => heard.push(value));
    root.fire('click');
    expect(label.props['text']).toBe('SHIELD ON');
    expect(root.props['backgroundColor']).toBe('#00ff00');
    handle.set(true); // no-op
    expect(heard).toEqual([true]);
  });

  it('falls back to ON/OFF labels without attributes', () => {
    const root = new FakeElement({ uix: 'toggle', uixId: 't' });
    const label = new FakeElement({ uixRole: 'label' });
    root.add(label);
    upgradePanel({}, wrap(root));
    expect(label.props['text']).toBe('OFF');
    root.fire('click');
    expect(label.props['text']).toBe('ON');
    // No colors configured — background untouched.
    expect(root.props['backgroundColor']).toBeUndefined();
  });
});

describe('expandable label control', () => {
  const LONG = 'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu';

  it('renders collapsed text, toggles on click, hides affordance when it fits', () => {
    const root = new FakeElement({
      uix: 'expandable-label',
      uixId: 'lore',
      uixText: LONG,
      uixLines: '1',
      uixCharsPerLine: '20',
    });
    const text = new FakeElement({ uixRole: 'text' });
    const toggle = new FakeElement({ uixRole: 'toggle' });
    root.add(text).add(toggle);
    const handle = upgradePanel({}, wrap(root)).expandableLabel('lore');
    expect(handle).toBeInstanceOf(ExpandableLabelHandle);
    expect(String(text.props['text'])).toContain('...');
    expect(toggle.props['display']).toBe('flex');
    expect(toggle.props['text']).toBe('more');

    toggle.fire('click');
    expect(text.props['text']).toBe(LONG);
    expect(toggle.props['text']).toBe('less');
    expect(handle.expanded).toBe(true);

    handle.setText('tiny');
    expect(text.props['text']).toBe('tiny');
    expect(toggle.props['display']).toBe('none');
  });
});

describe('log view control', () => {
  it('renders into the row pool, scrolls, clears and reports status', () => {
    const root = new FakeElement({ uix: 'log-view', uixId: 'log', uixCapacity: '10' });
    const rows = [
      new FakeElement({ uixRole: 'line' }),
      new FakeElement({ uixRole: 'line' }),
    ];
    const up = new FakeElement({ uixRole: 'up' });
    const down = new FakeElement({ uixRole: 'down' });
    const clear = new FakeElement({ uixRole: 'clear' });
    const status = new FakeElement({ uixRole: 'status' });
    rows.forEach((row) => root.add(row));
    root.add(up).add(down).add(clear).add(status);

    const handle = upgradePanel({}, wrap(root)).logView('log');
    expect(handle).toBeInstanceOf(LogViewHandle);
    expect(status.props['text']).toBe('0 entries');

    handle.push('one');
    handle.push('two');
    handle.push('three');
    expect(rows.map((row) => row.props['text'])).toEqual(['two', 'three']);
    expect(status.props['text']).toBe('3 entries');

    up.fire('click');
    expect(rows.map((row) => row.props['text'])).toEqual(['one', 'two']);
    expect(status.props['text']).toBe('3 entries (scrolled)');

    down.fire('click');
    expect(status.props['text']).toBe('3 entries');

    clear.fire('click');
    expect(rows.map((row) => row.props['text'])).toEqual(['', '']);
    expect(status.props['text']).toBe('0 entries');
  });
});

/** Wrap a control root in a plain panel root, as UIControlsSystem sees it. */
function wrap(control: FakeElement): FakeElement {
  return new FakeElement().add(control);
}
