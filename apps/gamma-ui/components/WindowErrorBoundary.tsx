import { Component, ErrorInfo, ReactNode } from "react";

interface Props {
  windowId: string;
  appId: string;
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class WindowErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[Gamma] Window ${this.props.windowId} crashed:`, error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            height: "100%",
            gap: 12,
            color: "var(--color-text-primary)",
            fontFamily: "var(--font-system)",
            padding: 24,
          }}
        >
          <span style={{ fontSize: 32 }}>⚠️</span>
          <p style={{ margin: 0, fontWeight: 600 }}>{this.props.appId} crashed</p>
          <p style={{ margin: 0, fontSize: 12, color: "var(--color-text-secondary)" }}>
            {this.state.error?.message}
          </p>
          <button
            onClick={() => this.setState({ hasError: false })}
            style={{
              marginTop: 8,
              padding: "6px 16px",
              borderRadius: 8,
              border: "1px solid var(--glass-border)",
              background: "var(--glass-bg)",
              color: "var(--color-text-primary)",
              cursor: "pointer",
              fontFamily: "var(--font-system)",
              fontSize: 13,
            }}
          >
            Restart
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
