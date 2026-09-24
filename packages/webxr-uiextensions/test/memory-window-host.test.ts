/**
 * The in-memory `WindowHost` mock: it passes the shipped conformance suite,
 * and the parts the suite does not reach behave as documented.
 */
import { describe, expect, it } from 'vitest';
import {
  MemoryPanel,
  MemoryWindowHost,
  WindowManager,
  createMemoryWindowHostSetup,
} from '../src/index.js';
import { windowHostContract } from './helpers/window-host-contract.js';

windowHostContract('MemoryWindowHost', createMemoryWindowHostSetup);

describe('MemoryWindowHost', () => {
  it('disposes a closed window panel and stops replaying it', () => {
    const manager = new WindowManager();
    const host = new MemoryWindowHost(manager);
    const handle = host.createWindow('a');
    host.attach('a');
    const panel = handle.panel as MemoryPanel;

    manager.close('a');

    expect(panel.disposed).toBe(true);
    const ids: string[] = [];
    host.onPanelReady((event) => ids.push(event.id));
    expect(ids).toEqual([]);
  });

  it('tells live subscribers when a panel attaches, and not after they unsubscribe', () => {
    const host = new MemoryWindowHost(new WindowManager());
    const ids: string[] = [];
    const stop = host.onPanelReady((event) => ids.push(`${event.kind}:${event.id}`));

    host.createWindow('a');
    host.attach('a');
    stop();
    host.createWindow('b');
    host.attach('b');

    expect(ids).toEqual(['window:a']);
  });

  it('does not replay a window whose panel has not attached yet', () => {
    const host = new MemoryWindowHost(new WindowManager());
    host.createWindow('waiting');
    const ids: string[] = [];

    host.onPanelReady((event) => ids.push(event.id));

    expect(ids).toEqual([]);
  });

  it('ignores attach for an unknown window or one already attached', () => {
    const host = new MemoryWindowHost(new WindowManager());
    const handle = host.createWindow('a');
    host.attach('a');
    const first = handle.panel;

    host.attach('a');
    host.attach('missing');

    expect(handle.panel).toBe(first);
  });

  it('drops an onReady listener that unsubscribes before the panel attaches', () => {
    const host = new MemoryWindowHost(new WindowManager());
    const handle = host.createWindow('a');
    let calls = 0;
    const stop = handle.onReady(() => {
      calls += 1;
    });

    stop();
    host.attach('a');

    expect(calls).toBe(0);
  });

  it('closes its windows on dispose, disposing their panels, and can be disposed twice', () => {
    const manager = new WindowManager();
    const host = new MemoryWindowHost(manager);
    const handle = host.createWindow('a');
    host.attach('a');
    host.createWindow('b');
    manager.close('b');
    const panel = handle.panel as MemoryPanel;

    host.dispose();

    expect(manager.has('a')).toBe(false);
    expect(panel.disposed).toBe(true);
    const ids: string[] = [];
    host.onPanelReady((event) => ids.push(event.id));
    expect(ids).toEqual([]);
    expect(() => host.dispose()).not.toThrow();
  });

  it('gives each panel an empty root', () => {
    const panel = new MemoryPanel();

    panel.setTargetDimensions(1, 0.5);
    panel.root.addEventListener('click', () => {});
    panel.root.setProperties({});

    expect(panel.getElementById('anything')).toBeUndefined();
    expect(panel.root.children).toEqual([]);
  });
});
