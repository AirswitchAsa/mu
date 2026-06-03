import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  handleToPath,
  type ColumnType,
  type Handle,
  type MetaJson,
  type Shape,
  type ViewSlice,
} from "@mu/protocol";
import { Duck, sqlLiteral } from "./duck.js";

const DUCK_TYPE: Record<ColumnType, string> = {
  int64: "BIGINT",
  float64: "DOUBLE",
  string: "VARCHAR",
  bool: "BOOLEAN",
};

const META = "meta.json";
// `.tmp` suffix so a crash mid-merge leaves it swept by sweepTmp and excluded
// from sizeBytes (it is staging, never committed state).
const INCOMING = "incoming.json.tmp";

function timeKeyOf(shape: Shape): string {
  return shape.merge.kind === "series" ? shape.merge.timeKey : "t";
}

function yearOf(epochMs: number): number {
  return new Date(epochMs).getUTCFullYear();
}

/** Convert DuckDB BIGINT (JS bigint) back to number for the shape's int64 columns. */
function normalizeRows(rows: Record<string, unknown>[], shape: Shape): Record<string, unknown>[] {
  const intCols = shape.columns.filter((c) => c.type === "int64").map((c) => c.name);
  if (intCols.length === 0) return rows;
  return rows.map((row) => {
    const out = { ...row };
    for (const c of intCols) {
      if (typeof out[c] === "bigint") out[c] = Number(out[c]);
    }
    return out;
  });
}

/**
 * Storage — the durable layer (data-architecture.md §6). A dataset is a directory
 * `<root>/<handle-as-path>/` of partition parquet files + a `meta.json` survey
 * card. Writes are temp-then-rename under the caller's per-handle mutex; readers
 * take no lock and always see a committed state.
 */
export class Storage {
  constructor(
    private readonly root: string,
    private readonly duck: Duck,
  ) {}

  dir(handle: Handle): string {
    return join(this.root, handleToPath(handle));
  }

  private glob(handle: Handle): string {
    return join(this.dir(handle), "*.parquet");
  }

  async exists(handle: Handle): Promise<boolean> {
    const dir = this.dir(handle);
    if (!existsSync(dir)) return false;
    const files = await readdir(dir).catch(() => [] as string[]);
    return files.some((f) => f.endsWith(".parquet"));
  }

  /** Delete orphaned temp files from a crashed write (swept before each ingest). */
  async sweepTmp(handle: Handle): Promise<void> {
    const dir = this.dir(handle);
    if (!existsSync(dir)) return;
    const files = await readdir(dir);
    await Promise.all(
      files.filter((f) => f.endsWith(".tmp")).map((f) => rm(join(dir, f), { force: true })),
    );
  }

  // ---- series merge (write path) -------------------------------------------

  private typeStruct(shape: Shape): string {
    return (
      "{" + shape.columns.map((c) => `${c.name}: '${DUCK_TYPE[c.type]}'`).join(", ") + "}"
    );
  }

  private colList(shape: Shape): string {
    return shape.columns.map((c) => c.name).join(", ");
  }

  /**
   * Union incoming rows into the affected year partitions by time key, overwriting
   * on collision, kept sorted (merge_series.dog.md). Only touched years are rewritten.
   * Each partition is written to a temp parquet then renamed (the commit point).
   */
  async mergeSeries(handle: Handle, shape: Shape, payload: readonly Record<string, unknown>[]): Promise<void> {
    const dir = this.dir(handle);
    await mkdir(dir, { recursive: true });
    const timeKey = timeKeyOf(shape);
    const cols = this.colList(shape);

    // Stage the increment to a JSON file so DuckDB types it via the column struct
    // (no manual VALUES escaping).
    const incPath = join(dir, INCOMING);
    await writeFile(incPath, JSON.stringify(payload), "utf8");

    try {
      const years = new Set<number>();
      for (const row of payload) years.add(yearOf(row[timeKey] as number));

      for (const year of years) {
        const partPath = join(dir, `${year}.parquet`);
        const tmpPath = `${partPath}.tmp`;
        const incSelect =
          `SELECT ${cols}, 1 AS __src FROM read_json(${sqlLiteral(incPath)}, ` +
          `columns = ${this.typeStruct(shape)}, format = 'array') ` +
          `WHERE year(epoch_ms(${timeKey})) = ${year}`;
        const union = existsSync(partPath)
          ? `${incSelect} UNION ALL SELECT ${cols}, 0 AS __src FROM read_parquet(${sqlLiteral(partPath)})`
          : incSelect;
        const sql =
          `COPY (` +
          `WITH src AS (${union}), ` +
          `ranked AS (SELECT *, row_number() OVER (PARTITION BY ${timeKey} ORDER BY __src DESC) AS __rn FROM src) ` +
          `SELECT ${cols} FROM ranked WHERE __rn = 1 ORDER BY ${timeKey}` +
          `) TO ${sqlLiteral(tmpPath)} (FORMAT PARQUET)`;
        await this.duck.run(sql);
        await rename(tmpPath, partPath);
      }
    } finally {
      await rm(incPath, { force: true });
    }
  }

  // ---- reads (resolve / view) ----------------------------------------------

  private buildSelect(handle: Handle, shape: Shape, slice?: ViewSlice): string {
    const timeKey = timeKeyOf(shape);
    const allCols = shape.columns.map((c) => c.name);
    const projected =
      slice?.fields && slice.fields.length > 0
        ? allCols.filter((c) => slice.fields!.includes(c))
        : allCols;
    const colList = (projected.length > 0 ? projected : allCols).join(", ");

    const conds: string[] = [];
    if (slice?.timeRange?.start !== undefined) conds.push(`${timeKey} >= ${slice.timeRange.start}`);
    if (slice?.timeRange?.end !== undefined) conds.push(`${timeKey} <= ${slice.timeRange.end}`);
    const where = conds.length > 0 ? ` WHERE ${conds.join(" AND ")}` : "";

    const base = `SELECT ${colList} FROM read_parquet(${sqlLiteral(this.glob(handle))})${where}`;
    if (slice?.last !== undefined) {
      // most-recent N, returned ascending
      return `SELECT * FROM (${base} ORDER BY ${timeKey} DESC LIMIT ${slice.last}) ORDER BY ${timeKey}`;
    }
    return `${base} ORDER BY ${timeKey}`;
  }

  /** Full / sliced read. Renderers call this for full data (resolve); view adds a guard. */
  async read(handle: Handle, shape: Shape, slice?: ViewSlice): Promise<Record<string, unknown>[]> {
    if (!(await this.exists(handle))) return [];
    const rows = await this.duck.all(this.buildSelect(handle, shape, slice));
    return normalizeRows(rows, shape);
  }

  /** Count rows a slice would return (bulk-guard input), before the `last` cap. */
  async count(handle: Handle, shape: Shape, slice?: ViewSlice): Promise<number> {
    if (!(await this.exists(handle))) return 0;
    const timeKey = timeKeyOf(shape);
    const conds: string[] = [];
    if (slice?.timeRange?.start !== undefined) conds.push(`${timeKey} >= ${slice.timeRange.start}`);
    if (slice?.timeRange?.end !== undefined) conds.push(`${timeKey} <= ${slice.timeRange.end}`);
    const where = conds.length > 0 ? ` WHERE ${conds.join(" AND ")}` : "";
    const rows = await this.duck.all(
      `SELECT count(*) AS n FROM read_parquet(${sqlLiteral(this.glob(handle))})${where}`,
    );
    const n = rows[0]?.["n"];
    return typeof n === "bigint" ? Number(n) : Number(n ?? 0);
  }

  // ---- meta.json sidecar ----------------------------------------------------

  async readMeta(handle: Handle): Promise<MetaJson | null> {
    const path = join(this.dir(handle), META);
    if (!existsSync(path)) return null;
    return JSON.parse(await readFile(path, "utf8")) as MetaJson;
  }

  /** Atomic sidecar write: temp file then rename, renamed after the data partitions. */
  async writeMeta(handle: Handle, meta: MetaJson): Promise<void> {
    const dir = this.dir(handle);
    await mkdir(dir, { recursive: true });
    const path = join(dir, META);
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify(meta, null, 2), "utf8");
    await rename(tmp, path);
  }

  async sizeBytes(handle: Handle): Promise<number> {
    const dir = this.dir(handle);
    if (!existsSync(dir)) return 0;
    const files = await readdir(dir);
    let total = 0;
    for (const f of files) {
      if (f.endsWith(".tmp")) continue;
      total += (await stat(join(dir, f))).size;
    }
    return total;
  }

  /** List every dataset's meta.json under the store (the catalog scan). */
  async listMeta(): Promise<MetaJson[]> {
    if (!existsSync(this.root)) return [];
    const metas: MetaJson[] = [];
    const walk = async (dir: string): Promise<void> => {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const e of entries) {
        const full = join(dir, e.name);
        if (e.isDirectory()) await walk(full);
        else if (e.name === META) metas.push(JSON.parse(await readFile(full, "utf8")) as MetaJson);
      }
    };
    await walk(this.root);
    return metas;
  }
}
