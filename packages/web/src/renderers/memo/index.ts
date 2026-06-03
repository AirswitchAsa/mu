import { memoMarkdown } from "../../lib/specs";
import type { RenderContext, RendererInstance, RendererPlugin } from "../types";

// =============================================================================
// memo — agent-authored markdown, no data binding. A deliberately tiny, safe
// markdown subset (escape first, then headings / bold / italic / code / breaks)
// — single-user self-hosted, but we still never inject raw HTML.
// =============================================================================

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function renderMarkdown(md: string): string {
  const lines = escapeHtml(md).split("\n");
  const html: string[] = [];
  for (const line of lines) {
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    if (h) {
      const level = h[1]!.length + 2; // h3..h5
      html.push(`<h${level}>${inline(h[2]!)}</h${level}>`);
    } else if (line.trim() === "") {
      html.push("<br/>");
    } else {
      html.push(`<p>${inline(line)}</p>`);
    }
  }
  return html.join("");
}

function inline(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>");
}

const plugin: RendererPlugin = {
  type: "memo",
  mount(el, ctx) {
    const body = document.createElement("div");
    body.className = "mu-memo";
    el.appendChild(body);
    const render = (c: RenderContext): void => {
      body.innerHTML = renderMarkdown(memoMarkdown(c.spec)) || `<p class="ds-caption">empty memo</p>`;
    };
    render(ctx);
    return {
      update: render,
      retheme() {
        /* memo inherits CSS vars; nothing to recolor */
      },
      destroy() {
        body.remove();
      },
    } satisfies RendererInstance;
  },
};

export default plugin;
