import React from "react";

interface Props {
  children: React.ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("[ErrorBoundary]", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "#1a1a2e",
            color: "#e0e0e0",
            fontFamily: "monospace",
            zIndex: 99999,
          }}
        >
          <div style={{ maxWidth: 520, padding: 32, textAlign: "center" }}>
            <h1 style={{ color: "#ff5f5f", fontSize: 20, marginBottom: 12 }}>
              Gamma Runtime crashed
            </h1>
            <pre
              style={{
                background: "#0d0d1a",
                padding: 16,
                borderRadius: 8,
                fontSize: 13,
                textAlign: "left",
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                maxHeight: 200,
                overflow: "auto",
                marginBottom: 16,
              }}
            >
              {this.state.error.message}
            </pre>
            <button
              onClick={() => window.location.reload()}
              style={{
                background: "#5f87ff",
                color: "#fff",
                border: "none",
                borderRadius: 6,
                padding: "8px 24px",
                cursor: "pointer",
                fontSize: 14,
                fontFamily: "monospace",
              }}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
