import { createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { memoMarkdown } from "../../lib/specs";
import { Markdown } from "../../ui/Markdown";
import type { RenderContext, RendererInstance, RendererPlugin } from "../types";

// =============================================================================
// memo — agent-authored markdown, no data binding. Renders through the SAME
// react-markdown + remark-gfm path as chat prose (the <Markdown> component), so
// tables / lists / code / backslash-escapes behave identically in cards and in
// chat — one markdown implementation, no drift. react-markdown never injects raw
// HTML, so model output still can't smuggle markup. `.mu-memo` is the scroll
// container; <Markdown> nests `.mu-prose` (already fully styled in app.css).
// =============================================================================

const plugin: RendererPlugin = {
  type: "memo",
  mount(el, ctx) {
    const host = document.createElement("div");
    host.className = "mu-memo";
    el.appendChild(host);
    const root: Root = createRoot(host);
    const render = (c: RenderContext): void => {
      const md = memoMarkdown(c.spec);
      root.render(
        md.trim() ? createElement(Markdown, { text: md }) : createElement("p", { className: "ds-caption" }, "empty memo"),
      );
    };
    render(ctx);
    return {
      update: render,
      retheme() {
        /* memo inherits CSS vars; nothing to recolor */
      },
      destroy() {
        // Defer the unmount: React 18 warns when a root is torn down synchronously
        // from inside a render/commit. Remove the host only after it unmounts.
        queueMicrotask(() => {
          root.unmount();
          host.remove();
        });
      },
    } satisfies RendererInstance;
  },
};

export default plugin;
