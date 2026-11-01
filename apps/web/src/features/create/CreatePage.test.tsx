import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";

import { createDiscussion } from "../../api/discussions";
import { makeDetail } from "../../test/fixtures";
import { CreatePage } from "./CreatePage";

vi.mock("../../api/discussions", () => ({
  createDiscussion: vi.fn(),
  getDiscussion: vi.fn(),
  listDiscussions: vi.fn(),
  getEvents: vi.fn(),
  getAllEvents: vi.fn(),
  confirmDiscussion: vi.fn(),
  regenerateRoster: vi.fn(),
  endDiscussion: vi.fn(),
}));

const mockedCreate = vi.mocked(createDiscussion);

function renderCreate(search = "") {
  return render(
    <MemoryRouter initialEntries={[`/new${search}`]}>
      <CreatePage />
    </MemoryRouter>,
  );
}

describe("CreatePage", () => {
  beforeEach(() => {
    mockedCreate.mockReset();
  });

  it("blocks submission until the topic has at least two characters", async () => {
    const user = userEvent.setup();
    renderCreate();

    const submit = screen.getByTestId("submit-create");
    expect(submit).toBeDisabled();

    await user.type(screen.getByTestId("topic-input"), "A");
    expect(submit).toBeDisabled();
    expect(screen.getByText("还需要 1 个字符")).toBeInTheDocument();

    await user.type(screen.getByTestId("topic-input"), "I");
    expect(submit).toBeEnabled();
  });

  it("counts code points and warns past the limit", async () => {
    const user = userEvent.setup();
    renderCreate();

    await user.type(screen.getByTestId("topic-input"), "远程办公会削弱创造力吗");
    expect(screen.getByTestId("topic-counter")).toHaveTextContent("11 / 200");
  });

  it("submits topic, expert count and a reused clientRequestId", async () => {
    const user = userEvent.setup();
    const detail = makeDetail();
    mockedCreate.mockResolvedValue({
      discussion: detail.discussion,
      experts: detail.experts,
    });

    renderCreate();

    await user.type(screen.getByTestId("topic-input"), "  AI 会取代产品经理吗？  ");
    await user.click(screen.getByTestId("expert-count-5"));
    await user.click(screen.getByTestId("submit-create"));

    await waitFor(() => expect(mockedCreate).toHaveBeenCalledTimes(1));

    const payload = mockedCreate.mock.calls[0][0];
    expect(payload.topic).toBe("AI 会取代产品经理吗？");
    expect(payload.expertCount).toBe(5);
    expect(payload.clientRequestId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("prefills the topic from the query string", () => {
    renderCreate("?topic=%E5%BC%80%E6%BA%90%E6%A8%A1%E5%9E%8B%E7%9A%84%E5%95%86%E4%B8%9A%E5%8C%96");
    expect(screen.getByTestId("topic-input")).toHaveValue("开源模型的商业化");
  });
});
