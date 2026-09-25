import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { ErrorBoundary } from "./components/ErrorBoundary";

const rootElement = document.getElementById("root");

if (rootElement === null) {
  throw new Error("Root element not found");
}

function dismissBootFallback(): void {
  document.getElementById("boot-fallback")?.remove();
}

function showBootError(message: string): void {
  const fallback = document.getElementById("boot-fallback");
  const detail = fallback?.querySelector("p");
  if (detail !== null && detail !== undefined) {
    detail.textContent = message;
  }
}

void import("./App")
  .then(({ App }) => {
    createRoot(rootElement).render(
      <StrictMode>
        <ErrorBoundary>
          <App />
        </ErrorBoundary>
      </StrictMode>,
    );
    dismissBootFallback();
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "起動に失敗しました";
    console.error("CivilCraft boot failed", error);
    showBootError(`${message}。再読み込みしてください。`);
  });
