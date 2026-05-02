import "./globals.css";

import { Component, type ReactNode,StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";

import App from "./App";

class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: 32, color: "#f87171", background: "#0e0f13", height: "100vh", fontFamily: "monospace" }}>
          <h1 style={{ fontSize: 18, marginBottom: 12 }}>Runtime Error</h1>
          <pre style={{ fontSize: 13, color: "#e2e8f0", whiteSpace: "pre-wrap", lineHeight: 1.6 }}>
            {this.state.error.message}
          </pre>
          <pre style={{ fontSize: 11, color: "#64748b", whiteSpace: "pre-wrap", marginTop: 12 }}>
            {this.state.error.stack}
          </pre>
          <button
            onClick={() => this.setState({ error: null })}
            style={{ marginTop: 16, padding: "6px 16px", background: "#f59e0b", color: "#0e0f13", border: "none", borderRadius: 4, cursor: "pointer", fontSize: 13 }}
          >
            Try Again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>
);
