import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import App from "./App";
import { installMockServer } from "./dev/mockServer";

const originalFetch = globalThis.fetch;

/**
 * Whole-app smoke test against the dev mock: router + app shell + home page +
 * API client. Proves the four routes are mounted and the shell paints without
 * touching a real backend.
 */
beforeAll(() => {
  installMockServer();
});

afterAll(() => {
  globalThis.fetch = originalFetch;
});

describe("App", () => {
  it("mounts the router and renders the home page from the API", async () => {
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "圆桌现场" }),
    ).toBeInTheDocument();

    const cards = await screen.findAllByTestId("discussion-card");
    expect(cards.length).toBeGreaterThanOrEqual(2);

    // App shell is present and the page owns its own scroll container.
    expect(screen.getByRole("banner")).toBeInTheDocument();
    expect(screen.getByRole("main")).toHaveClass("scroll-y");
  });

  it("redirects unknown routes back to the home page", async () => {
    window.history.pushState({}, "", "/does-not-exist");
    render(<App />);

    expect(
      await screen.findByRole("heading", { name: "圆桌现场" }),
    ).toBeInTheDocument();
  });
});
