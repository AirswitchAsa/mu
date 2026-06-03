import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

// =============================================================================
// µ — agent prose as markdown. react-markdown never renders raw HTML (no
// dangerouslySetInnerHTML), so model output can't inject markup; remark-gfm adds
// lists/tables/strikethrough/autolinks. Links are forced to open safely in a new
// tab. Styling lives under `.mu-prose` in app.css.
// =============================================================================

export function Markdown({ text }: { text: string }): JSX.Element {
  return (
    <div className="mu-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: ({ children, href }) => (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}
