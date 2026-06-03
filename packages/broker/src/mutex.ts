/**
 * Minimal async mutexes. The broker uses two layers (atomic-write.dog.md):
 * a {@link KeyedMutex} per `&Handle` makes each logical ingest atomic, and a
 * plain {@link Mutex} inside the DuckDB wrapper serializes statements on the one
 * connection (driver safety). Single-process µ needs no DB-grade concurrency.
 */
export class Mutex {
  private tail: Promise<void> = Promise.resolve();

  async runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const prev = this.tail;
    let release!: () => void;
    this.tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await prev;
    try {
      return await fn();
    } finally {
      release();
    }
  }
}

export class KeyedMutex {
  private readonly locks = new Map<string, Mutex>();

  runExclusive<T>(key: string, fn: () => Promise<T>): Promise<T> {
    let lock = this.locks.get(key);
    if (!lock) {
      lock = new Mutex();
      this.locks.set(key, lock);
    }
    return lock.runExclusive(fn);
  }
}
