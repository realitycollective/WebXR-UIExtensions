import { describe, expect, it, vi } from 'vitest';
import { Emitter } from '../src/core/events.js';

type Events = { ping: number; note: string };

describe('Emitter', () => {
  it('delivers events to subscribers', () => {
    const emitter = new Emitter<Events>();
    const heard: number[] = [];
    emitter.on('ping', (n) => heard.push(n));
    emitter.emit('ping', 1);
    emitter.emit('ping', 2);
    expect(heard).toEqual([1, 2]);
  });

  it('emit on an event with no listeners is a no-op', () => {
    const emitter = new Emitter<Events>();
    expect(() => emitter.emit('note', 'quiet')).not.toThrow();
  });

  it('on returns an unsubscribe function', () => {
    const emitter = new Emitter<Events>();
    const listener = vi.fn();
    const dispose = emitter.on('ping', listener);
    dispose();
    emitter.emit('ping', 3);
    expect(listener).not.toHaveBeenCalled();
  });

  it('off removes a specific listener', () => {
    const emitter = new Emitter<Events>();
    const a = vi.fn();
    const b = vi.fn();
    emitter.on('ping', a);
    emitter.on('ping', b);
    emitter.off('ping', a);
    emitter.emit('ping', 4);
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledWith(4);
  });

  it('off before any subscription is a no-op', () => {
    const emitter = new Emitter<Events>();
    expect(() => emitter.off('ping', vi.fn())).not.toThrow();
  });

  it('once fires exactly one time', () => {
    const emitter = new Emitter<Events>();
    const listener = vi.fn();
    emitter.once('ping', listener);
    emitter.emit('ping', 5);
    emitter.emit('ping', 6);
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(5);
  });

  it('once can be cancelled before it fires', () => {
    const emitter = new Emitter<Events>();
    const listener = vi.fn();
    const dispose = emitter.once('ping', listener);
    dispose();
    emitter.emit('ping', 7);
    expect(listener).not.toHaveBeenCalled();
  });

  it('listeners can unsubscribe during emit without breaking delivery', () => {
    const emitter = new Emitter<Events>();
    const heard: string[] = [];
    const dispose = emitter.on('note', () => {
      heard.push('first');
      dispose();
    });
    emitter.on('note', () => heard.push('second'));
    emitter.emit('note', 'x');
    emitter.emit('note', 'y');
    expect(heard).toEqual(['first', 'second', 'second']);
  });

  it('tracks listener count and clears', () => {
    const emitter = new Emitter<Events>();
    expect(emitter.listenerCount('ping')).toBe(0);
    emitter.on('ping', vi.fn());
    emitter.on('ping', vi.fn());
    expect(emitter.listenerCount('ping')).toBe(2);
    emitter.clear();
    expect(emitter.listenerCount('ping')).toBe(0);
  });
});
