import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = {
  children: ReactNode;
};

type State = {
  message: string | null;
};

export class ErrorBoundary extends Component<Props, State> {
  state: State = { message: null };

  static getDerivedStateFromError(error: Error): State {
    return { message: error.message || "不明なエラー" };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("App render failed", error, info.componentStack);
  }

  render() {
    if (this.state.message !== null) {
      return (
        <main className="fatal-error" role="alert">
          <h1>画面の表示に失敗しました</h1>
          <p>{this.state.message}</p>
          <p>ページを再読み込みするか、開発サーバーを再起動してください。</p>
          <button type="button" onClick={() => window.location.reload()}>
            再読み込み
          </button>
        </main>
      );
    }

    return this.props.children;
  }
}
