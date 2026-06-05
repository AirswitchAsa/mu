import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMuServer, type MuServerHandle } from "./server.js";

// =============================================================================
// The single-image deploy serves the built web client from the µ server itself
// (MU_WEB_DIR / opts.webDir): the client is same-origin with the API, so no CORS.
// These tests exercise the real HTTP pathway (no LLM) against a tiny fake webDir:
// real file → streamed with the right type; unknown route → SPA index fallback;
// /api still answers JSON; traversal is confined. This is what makes the container
// actually serve a page; without it the image would 404 on `/`.
// =============================================================================

const RESOURCES_DIR = join(dirname(fileURLToPath(import.meta.url)), "../../../resources");

describe("static web serving (single-image deploy)", () => {
  let server: MuServerHandle;
  let root: string;
  let webDir: string;

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), "mu-staticweb-"));
    webDir = join(root, "web");
    await mkdir(join(webDir, "assets"), { recursive: true });
    await writeFile(join(webDir, "index.html"), "<!doctype html><title>µ</title><div id=root></div>");
    await writeFile(join(webDir, "assets", "app-abc123.js"), "console.log('hi')");
    server = await createMuServer({ dataRoot: root, resourcesDir: RESOURCES_DIR, webDir });
  }, 60_000);
  afterAll(async () => {
    await server?.close();
    if (root) await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  });

  it("serves index.html at /", async () => {
    const r = await fetch(`${server.url}/`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/text\/html/);
    expect(await r.text()).toContain('id=root');
  });

  it("serves a hashed asset with the right content-type and an immutable cache", async () => {
    const r = await fetch(`${server.url}/assets/app-abc123.js`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/javascript/);
    expect(r.headers.get("cache-control")).toContain("immutable");
    expect(await r.text()).toContain("console.log");
  });

  it("falls back to index.html for an unknown client-side route (SPA)", async () => {
    const r = await fetch(`${server.url}/sessions/abc/canvas-that-is-a-spa-route`);
    expect(r.status).toBe(200);
    expect(r.headers.get("content-type")).toMatch(/text\/html/);
    expect(await r.text()).toContain("<title>µ</title>");
  });

  it("still answers /api as JSON, never the SPA shell", async () => {
    const ok = await fetch(`${server.url}/api/renderers`);
    expect(ok.headers.get("content-type")).toMatch(/application\/json/);
    expect(Array.isArray((await ok.json()).renderers)).toBe(true);

    const miss = await fetch(`${server.url}/api/nope`);
    expect(miss.status).toBe(404);
    expect((await miss.json()).error.code).toBe("NOT_FOUND");
  });

  it("does not escape webDir via path traversal (degrades to the SPA index)", async () => {
    // `/../package.json` must NOT leak a file outside webDir; it serves index.html instead.
    const r = await fetch(`${server.url}/../../package.json`);
    expect(r.status).toBe(200);
    const body = await r.text();
    expect(body).toContain("<title>µ</title>");
    expect(body).not.toContain("\"name\"");
  });
});
