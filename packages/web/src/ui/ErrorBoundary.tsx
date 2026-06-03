import { Component, type ReactNode } from "react";

// =============================================================================
// µ — per-window error boundary. The canvas renders agent-authored content; a
// surprise spec or binding could make a renderer (or a legend) throw. React
// boundaries catch errors thrown during render AND during commit (effect mounts/
// updates), so wrapping each window isolates a crash to that one frame instead of
// blanking the whole app. `resetKey` clears the error when the window's content
// changes — so a later, valid spec from the agent recovers the window.
// =============================================================================

interface Props {
  resetKey: string;
  label?: string;
  children: ReactNode;
}
interface State {
  message: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { message: null };

  static getDerivedStateFromError(error: unknown): State {
    return { message: error instanceof Error ? error.message : String(error) };
  }

  componentDidUpdate(prev: Props): void {
    if (prev.resetKey !== this.props.resetKey && this.state.message) {
      this.setState({ message: null });
    }
  }

  render(): ReactNode {
    if (this.state.message !== null) {
      return (
        <div className="mu-win mu-win--error">
          <div className="mu-win__fallback">
            {this.props.label ?? "render error"}
            <span className="ds-spec">{this.state.message}</span>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
