import { Component, type ReactNode } from 'react';

/** Keeps one broken screen from blanking the whole app. */
export class ErrorBoundary extends Component<
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
        <div style={{ padding: 24, color: '#ff9d8f' }}>
          <h2>Hoppá — hiba történt</h2>
          <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12 }}>{String(this.state.error)}</pre>
          <button onClick={() => this.setState({ error: null })}>Újrapróbálás</button>
        </div>
      );
    }
    return this.props.children;
  }
}
