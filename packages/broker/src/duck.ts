import { DuckDBInstance, type DuckDBConnection } from "@duckdb/node-api";
import { Mutex } from "./mutex.js";

/**
 * A thin, serialized wrapper over one in-memory DuckDB connection used purely as
 * a compute engine over on-disk parquet/json. All statements run through a single
 * mutex so the one connection is never hit concurrently; logical atomicity per
 * dataset is the broker's `KeyedMutex` job, layered above this.
 */
export class Duck {
  private readonly lock = new Mutex();
  private constructor(private readonly conn: DuckDBConnection) {}

  static async create(): Promise<Duck> {
    const instance = await DuckDBInstance.create(":memory:");
    const conn = await instance.connect();
    return new Duck(conn);
  }

  /** Run a statement with no result (DDL / COPY). */
  run(sql: string): Promise<void> {
    return this.lock.runExclusive(async () => {
      await this.conn.run(sql);
    });
  }

  /** Run a query and materialize all rows as plain objects (DuckDB-native JS values). */
  all(sql: string): Promise<Record<string, unknown>[]> {
    return this.lock.runExclusive(async () => {
      const reader = await this.conn.runAndReadAll(sql);
      return reader.getRowObjects() as Record<string, unknown>[];
    });
  }
}

/** Escape a string for use as a single-quoted SQL literal (paths, globs). */
export function sqlLiteral(value: string): string {
  return "'" + value.replace(/'/g, "''") + "'";
}
