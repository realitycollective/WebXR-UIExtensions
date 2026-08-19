/**
 * Minimal typed event emitter.
 *
 * The library keeps its observable surface deliberately tiny — consumers that
 * want richer eventing can bridge these into their own bus (for example the
 * Reality Collective service framework's IEventService).
 */
export type Listener<T> = (payload: T) => void;

export class Emitter<TEvents extends Record<string, unknown>> {
  private listeners = new Map<keyof TEvents, Set<Listener<never>>>();

  on<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    set.add(listener as Listener<never>);
    return () => this.off(event, listener);
  }

  once<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): () => void {
    const dispose = this.on(event, (payload) => {
      dispose();
      listener(payload);
    });
    return dispose;
  }

  off<K extends keyof TEvents>(event: K, listener: Listener<TEvents[K]>): void {
    this.listeners.get(event)?.delete(listener as Listener<never>);
  }

  emit<K extends keyof TEvents>(event: K, payload: TEvents[K]): void {
    // Copy before iterating so listeners can unsubscribe (or subscribe) safely
    // from inside a handler without corrupting the iteration.
    const set = this.listeners.get(event);
    if (!set) {
      return;
    }
    for (const listener of [...set]) {
      (listener as Listener<TEvents[K]>)(payload);
    }
  }

  listenerCount<K extends keyof TEvents>(event: K): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  clear(): void {
    this.listeners.clear();
  }
}
