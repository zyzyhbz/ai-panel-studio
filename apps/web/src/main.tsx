import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

const mount = root;

async function bootstrap() {
  // DEV-only mock backend, opt-in via `VITE_MOCK_API=1`.
  // The guard is statically false in production, so the import is dropped.
  if (import.meta.env.DEV && import.meta.env.VITE_MOCK_API === "1") {
    const { installMockServer } = await import("./dev/mockServer");
    installMockServer();
  }

  createRoot(mount).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void bootstrap();
