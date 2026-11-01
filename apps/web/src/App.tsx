import { Component, type ErrorInfo, type ReactNode } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AppShell } from "./app/AppShell";
import { Button } from "./components/ui/Button";
import { CreatePage } from "./features/create/CreatePage";
import { HomePage } from "./features/home/HomePage";
import { ReplayPage } from "./features/replay/ReplayPage";
import { StudioPage } from "./features/studio/StudioPage";

class Boundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Never surface a stack to the user; log for local debugging only.
    console.error("[ui] unhandled error", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div className="flex h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
          <p className="text-sm text-ink-1">页面出了点问题。</p>
          <p className="max-w-sm text-xs leading-6 text-ink-4">
            刷新可以重新加载；已经保存的讨论不会丢失。
          </p>
          <Button onClick={() => window.location.assign("/")}>回到首页</Button>
        </div>
      );
    }
    return this.props.children;
  }
}

export default function App() {
  return (
    <Boundary>
      <BrowserRouter>
        <Routes>
          <Route
            path="/"
            element={
              <AppShell>
                <HomePage />
              </AppShell>
            }
          />
          <Route
            path="/new"
            element={
              <AppShell>
                <CreatePage />
              </AppShell>
            }
          />
          <Route path="/d/:id" element={<StudioPage />} />
          <Route path="/d/:id/replay" element={<ReplayPage />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </Boundary>
  );
}
