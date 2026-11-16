"use client";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { toastError } from "./toast";

type State = { error: Error | null };

/** Keeps a crash inside the Command Center from blanking the whole JARVIS screen. */
export default class ErrorBoundary extends Component<{ children: ReactNode; onExit?: () => void }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Command Center crashed:", error, info.componentStack);
    toastError(`Command Center error: ${error.message}`);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="cc-boundary" role="alert">
        <div className="cc-card">
          <div className="cc-card-title">COMMAND CENTER CRASHED</div>
          <pre className="cc-pre">{this.state.error.message.slice(0, 400)}</pre>
          <div className="cc-row">
            <button className="cc-btn primary" onClick={() => this.setState({ error: null })}>Try again</button>
            {this.props.onExit && <button className="cc-btn" onClick={this.props.onExit}>Back to orb</button>}
          </div>
        </div>
      </div>
    );
  }
}
