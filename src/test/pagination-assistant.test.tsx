import { TooltipProvider } from "@/components/ui/tooltip";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";
import { PaginationAssistant } from "@/features/cms-articles/PaginationAssistant";
import { EditorView } from "@tiptap/pm/view";
import { ScrollArea } from "@/components/ui/scroll-area";
import { parseCompatible } from "@/features/cms-articles/editor-content";
import { aiService } from "@/features/ai/service";
import { paginationSettings } from "./ai-fixtures";
import { deferred } from "./cms-fixtures";
import {
  invalidateClientRequests,
  ServiceError,
} from "@/services/tauri/client";
import RichTextEditor from "@/features/cms-articles/RichTextEditor";

vi.mock("@/features/ai/service", () => ({
  aiService: { load: vi.fn(), paginate: vi.fn() },
}));
const parse = (html: string) => {
  const container = document.createElement("div");
  container.innerHTML = html;
  return parseCompatible(container);
};
const body = parse(
  `<p>【演示数据】${"演".repeat(220)}。</p><p>${"示".repeat(220)}。</p>`,
);
const props = () => ({
  doc: body,
  title: "演示文章标题",
  locked: false,
  canInsert: true,
  onInsert: vi.fn(),
  onRemove: vi.fn(),
  onApply: vi.fn(),
  onLocate: vi.fn(),
  onClose: vi.fn(),
  onAfterClose: vi.fn(),
});
const response = {
  jobId: crypto.randomUUID(),
  templateId: "pagination-1",
  modelConfigId: "model-1",
  bind_after: [],
  prefer_after: [],
  breakAfter: ["B1"],
  paginationOptions: { minChars: 100, targetChars: 240, maxChars: 400 },
};
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(aiService.load).mockResolvedValue(paginationSettings());
  vi.mocked(aiService.paginate).mockResolvedValue(response);
});
const mount = (p = props()) => ({
  ...render(
    <MemoryRouter>
      <PaginationAssistant {...p} />
    </MemoryRouter>,
  ),
  p,
});
const generate = async () => {
  const button = await screen.findByRole("button", { name: "AI 生成分页" });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
};

it("隐藏配置选择并使用默认分页模板绑定的模型；生成预览后显式应用", async () => {
  const settings = paginationSettings();
  settings.templates.find((t) => t.id === "pagination-1")!.modelConfigId =
    "model-2";
  vi.mocked(aiService.load).mockResolvedValue(settings);
  const { p } = mount();
  await waitFor(() =>
    expect(screen.getByRole("button", { name: "AI 生成分页" })).toBeEnabled(),
  );
  expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
  expect(screen.queryByText("分页模板")).not.toBeInTheDocument();
  expect(screen.queryByText("AI 模型")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: /配置/ }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText(/本次选择/)).not.toBeInTheDocument();
  expect(aiService.paginate).not.toHaveBeenCalled();
  await generate();
  expect(await screen.findByText("初稿尚未应用")).toBeVisible();
  expect(p.onApply).not.toHaveBeenCalled();
  expect(aiService.paginate).toHaveBeenCalledWith(
    expect.objectContaining({
      title: p.title,
      templateId: "pagination-1",
      modelConfigId: "model-2",
    }),
    expect.any(AbortSignal),
  );
  await userEvent.click(screen.getByRole("button", { name: "应用初稿" }));
  expect(p.onApply).toHaveBeenCalledWith(body, expect.anything());
  expect(p.onClose).not.toHaveBeenCalled();
});
it("卸载取消请求并丢弃迟到结果，重新打开读取最新默认配置", async () => {
  const pending = deferred<typeof response>();
  vi.mocked(aiService.paginate).mockReturnValue(pending.promise);
  const view = mount();
  await generate();
  const signal = vi.mocked(aiService.paginate).mock.calls[0][1]!;
  view.unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(response));
  const settings = paginationSettings();
  settings.templates.find((t) => t.id === "pagination-1")!.modelConfigId =
    "model-2";
  vi.mocked(aiService.load).mockResolvedValue(settings);
  mount();
  await generate();
  expect(aiService.load).toHaveBeenCalledTimes(2);
  expect(aiService.paginate).toHaveBeenLastCalledWith(
    expect.objectContaining({
      templateId: "pagination-1",
      modelConfigId: "model-2",
    }),
    expect.any(AbortSignal),
  );
});
it("取消、关闭和登录变化均丢弃响应，正文变化使预览失效", async () => {
  const p = props();
  const view = mount(p);
  await generate();
  await screen.findByText("初稿尚未应用");
  view.rerender(
    <MemoryRouter>
      <PaginationAssistant {...p} doc={parse("<p>【演示数据】已修改</p>")} />
    </MemoryRouter>,
  );
  expect(screen.getByRole("button", { name: "应用初稿" })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "取消初稿" }));
  const pending = deferred<typeof response>();
  vi.mocked(aiService.paginate).mockReturnValue(pending.promise);
  await generate();
  const signal = vi.mocked(aiService.paginate).mock.calls[1][1]!;
  await userEvent.click(screen.getByRole("button", { name: "取消生成" }));
  expect(signal.aborted).toBe(true);
  await act(async () => pending.resolve(response));
  expect(
    screen.queryByRole("button", { name: "应用初稿" }),
  ).not.toBeInTheDocument();
  await generate();
  act(() => invalidateClientRequests());
  expect(
    screen.queryByRole("button", { name: "应用初稿" }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "关闭" }));
  expect(p.onClose).toHaveBeenCalledTimes(1);
});
it.each([
  [
    "默认模板",
    (settings: ReturnType<typeof paginationSettings>) => {
      settings.templates.find((t) => t.purpose === "pagination")!.isDefault =
        false;
    },
    "尚未设置默认文章分页模板",
  ],
  [
    "绑定模型",
    (settings: ReturnType<typeof paginationSettings>) => {
      settings.templates.find(
        (t) => t.purpose === "pagination",
      )!.modelConfigId = null;
    },
    "尚未绑定有效模型",
  ],
  [
    "已删除模型",
    (settings: ReturnType<typeof paginationSettings>) => {
      settings.models = [];
    },
    "尚未绑定有效模型",
  ],
] as const)(
  "缺少%s时显示原因与设置入口，不请求 AI",
  async (_name, modify, reason) => {
    const settings = paginationSettings();
    modify(settings);
    vi.mocked(aiService.load).mockResolvedValue(settings);
    const { p } = mount();
    expect(await screen.findByRole("alert")).toHaveTextContent(reason);
    const button = screen.getByRole("button", { name: "AI 生成分页" });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(aiService.paginate).not.toHaveBeenCalled();
    await userEvent.click(
      screen.getByRole("button", { name: "配置默认分页模板" }),
    );
    expect(p.onClose).toHaveBeenCalledTimes(1);
  },
);
it("请求错误保留正文和分页，不自动重试", async () => {
  vi.mocked(aiService.paginate).mockRejectedValue(new Error("演示网络错误"));
  const { p } = mount();
  await generate();
  expect(await screen.findByRole("alert")).toHaveTextContent("演示网络错误");
  expect(p.onApply).not.toHaveBeenCalled();
  expect(aiService.paginate).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole("button", { name: "关闭" }));
});

it("输出上限错误保留已有分页与格式，允许手动重试", async () => {
  const original = parse(
    "<p><strong>【演示数据】原来的第一页。</strong></p><p>[!--empirenews.page--]</p><p>原来的第二页。</p>",
  );
  const before = original.toJSON();
  vi.mocked(aiService.paginate).mockRejectedValueOnce(
    new ServiceError(
      "AI_OUTPUT_LIMIT",
      "输出达到 token 上限（包含推理消耗），请检查模型的推理强度和输出上限后手动重试",
    ),
  );
  const { p } = mount({ ...props(), doc: original });
  await generate();
  expect(await screen.findByRole("alert")).toHaveTextContent("包含推理消耗");
  expect(screen.getByText(/共 2 页/)).toBeVisible();
  expect(screen.getByText("【演示数据】原来的第一页。").tagName).toBe("STRONG");
  expect(original.toJSON()).toEqual(before);
  expect(p.onApply).not.toHaveBeenCalled();
  expect(aiService.paginate).toHaveBeenCalledTimes(1);
  expect(
    screen.queryByRole("button", { name: "应用初稿" }),
  ).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "下一页" }));
  expect(screen.getByText("原来的第二页。")).toBeVisible();
  await generate();
  await screen.findByText("初稿尚未应用");
  expect(aiService.paginate).toHaveBeenCalledTimes(2);
  expect(p.onApply).not.toHaveBeenCalled();
});

it("分页定位恢复正文焦点后触发选区滚动，不修改正文", async () => {
  vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);
  const coords = vi.spyOn(EditorView.prototype, "coordsAtPos").mockReturnValue({
    left: 0,
    right: 1,
    top: 0,
    bottom: 1,
  });
  const onChange = vi.fn();
  render(
    <MemoryRouter>
      <TooltipProvider>
        <ScrollArea className="h-80">
          <RichTextEditor
            initialHtml="<p>【演示数据】第一页。</p><p>[!--empirenews.page--]</p><p>第二页。</p>"
            title="演示文章"
            disabled={false}
            onChange={onChange}
            onUploading={vi.fn()}
            onError={vi.fn()}
          />
        </ScrollArea>
      </TooltipProvider>
    </MemoryRouter>,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "分页助手" }),
  );
  await userEvent.click(screen.getByRole("button", { name: "下一页" }));
  coords.mockClear();
  await userEvent.click(screen.getByRole("button", { name: "定位正文" }));
  await waitFor(() => expect(coords).toHaveBeenCalled());
  expect(screen.getByRole("textbox", { name: "文章正文" })).toHaveFocus();
  expect(window.getSelection()?.anchorNode?.textContent).toBe("第二页。");
  expect(onChange).not.toHaveBeenCalled();
});

it("编辑器应用分页只更新本地正文，一次撤销恢复原始 HTML", async () => {
  vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);
  Object.defineProperties(Range.prototype, {
    getClientRects: {
      configurable: true,
      value: () => [new DOMRect(0, 0, 10, 10)],
    },
    getBoundingClientRect: {
      configurable: true,
      value: () => new DOMRect(0, 0, 10, 10),
    },
  });
  const original = `<p>【演示数据】${"演".repeat(220)}。</p><p>${"示".repeat(220)}。</p>`;
  const onChange = vi.fn();
  render(
    <MemoryRouter>
      <TooltipProvider>
        <RichTextEditor
          initialHtml={original}
          title="演示文章"
          disabled={false}
          onChange={onChange}
          onUploading={vi.fn()}
          onError={vi.fn()}
        />
      </TooltipProvider>
    </MemoryRouter>,
  );
  await userEvent.click(
    await screen.findByRole("button", { name: "分页助手" }),
  );
  await generate();
  await screen.findByText("初稿尚未应用");
  await userEvent.click(screen.getByRole("button", { name: "应用初稿" }));
  await waitFor(() => expect(onChange).toHaveBeenCalled());
  expect(onChange.mock.lastCall?.[0]).toContain("[!--empirenews.page--]");
  await userEvent.click(screen.getByRole("button", { name: "关闭" }));
  await userEvent.click(screen.getByRole("button", { name: "撤销" }));
  await waitFor(() => expect(onChange.mock.lastCall?.[0]).toBe(original));
});
