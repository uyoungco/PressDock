import { useState } from "react";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ArticleTable } from "@/features/cms-articles/ArticleTable";
import { ArticleFilters } from "@/features/cms-articles/ArticleFilters";
import { EditorSheet } from "@/features/cms-articles/EditorSheet";
import {
  articleColumns,
  articleInput,
  articleService,
  defaultQuery,
} from "@/features/cms-articles/service";
import {
  columnStorageKey,
  useColumnPreferences,
} from "@/hooks/use-column-preferences";
import type { CmsArticleDetail } from "@/types/cms-article";
import { EditorView } from "@tiptap/pm/view";

const article: CmsArticleDetail = {
  id: 8101,
  title: "【演示】紧凑文章",
  classId: 1,
  className: "社会",
  writer: "演示编辑",
  snapshot: {},
  titlePic: null,
  titlePic2: null,
  titlePic3: null,
  smallText: "演示摘要",
  sourceUrl: "https://demo.invalid/source",
  newsTime: "2026-11-06 09:42:00",
  pages: 2,
  tags: ["演示标签"],
  nTags: ["扩展演示"],
  commentRecommand: "头条推荐",
  commentPromote: ["演示渠道 / 轮播", "演示渠道 / 第二位置"],
  newsText:
    '<p style="text-align: center"><strong>【演示】原始正文。</strong></p><p>[!--empirenews.page--]</p><p>第二页。</p>',
  status: 1,
  updatedAt: null,
};
const edit = vi.fn(),
  promote = vi.fn(),
  preview = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(articleService, "openLink").mockResolvedValue(null);
  // jsdom 不提供 Range 几何信息；正文撤销后滚动选区需要此浏览器能力。
  vi.spyOn(EditorView.prototype, "coordsAtPos").mockReturnValue({
    left: 0,
    right: 1,
    top: 0,
    bottom: 1,
  });
  vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);
});
function List({
  layout = "wide",
  view = "quality",
}: {
  layout?: "wide" | "compact" | "cards";
  view?: "quality" | "review-2";
}) {
  const preferences = useColumnPreferences(
    "cms-articles-quality",
    articleColumns,
  );
  return (
    <TooltipProvider>
      <button onClick={preferences.reset}>重置列</button>
      <ArticleTable
        rows={[article]}
        preferences={preferences}
        view={view}
        layout={layout}
        busy={false}
        onEdit={edit}
        onPromote={promote}
        onPreview={preview}
      />
    </TooltipProvider>
  );
}
it("默认四列聚合，编号保留打开能力，更多菜单打开完整字段", async () => {
  render(<List />);
  expect(screen.getAllByRole("columnheader")).toHaveLength(4);
  expect(screen.getByRole("columnheader", { name: "新闻内容" })).toBeVisible();
  expect(screen.getByText("已推荐 · 分发 2 处")).toBeVisible();
  await userEvent.click(screen.getByRole("link", { name: "8101" }));
  expect(articleService.openLink).toHaveBeenCalledWith(
    expect.stringContaining("/h/8101.html"),
  );
  await userEvent.click(
    screen.getByRole("button", { name: "文章 8101 更多操作" }),
  );
  await userEvent.click(screen.getByRole("menuitem", { name: "查看完整信息" }));
  const dialog = await screen.findByRole("dialog", {
    name: "文章完整信息 · 8101",
  });
  expect(within(dialog).getByText("扩展演示")).toBeVisible();
  expect(within(dialog).getByText("演示标签")).toBeVisible();
  expect(within(dialog).getByText("演示渠道 / 第二位置")).toBeVisible();
  expect(within(dialog).getByText("演示摘要")).toBeVisible();
});
it("旧偏好保留显式列宽和显隐，恢复默认采用四列", async () => {
  localStorage.setItem(
    columnStorageKey("cms-articles-quality"),
    JSON.stringify({
      version: 1,
      visibility: { writer: true, titlePic: false },
      sizing: { title: 580 },
    }),
  );
  render(<List />);
  expect(screen.getByRole("columnheader", { name: "作者" })).toBeVisible();
  expect(
    screen.queryByRole("columnheader", { name: "配图" }),
  ).not.toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "新闻内容" })).toHaveStyle({
    width: "580px",
  });
  await userEvent.click(screen.getByRole("button", { name: "重置列" }));
  expect(screen.getAllByRole("columnheader")).toHaveLength(4);
  expect(
    screen.queryByRole("columnheader", { name: "作者" }),
  ).not.toBeInTheDocument();
});
it("紧凑状态收拢分发且审核类别没有转素材动作，菜单 Esc 返回触发器", async () => {
  render(<List layout="compact" view="review-2" />);
  expect(screen.getAllByRole("columnheader")).toHaveLength(3);
  expect(screen.getByRole("table")).toHaveStyle({ width: "100%" });
  expect(screen.getByText("已推荐 · 分发 2 处")).toBeVisible();
  expect(
    screen.queryByRole("button", { name: "转素材" }),
  ).not.toBeInTheDocument();
  const trigger = screen.getByRole("button", { name: "文章 8101 更多操作" });
  await userEvent.click(trigger);
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(trigger).toHaveFocus());
});
it("卡片保留图文信息及编辑动作", async () => {
  render(<List layout="cards" />);
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.getByText(article.title!)).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "编辑" }));
  expect(edit).toHaveBeenCalledWith(article);
});
it("低频筛选按需展开且只在点击搜索时提交", async () => {
  const submit = vi.fn();
  function Filters() {
    const [draft, setDraft] = useState(defaultQuery("quality"));
    return (
      <ArticleFilters
        view="quality"
        draft={draft}
        onChange={setDraft}
        onSubmit={() => submit(draft)}
        onReset={() => setDraft(defaultQuery("quality"))}
        locked={false}
        classes={[{ id: 1, name: "社会" }]}
        classesError={null}
        retryClasses={vi.fn()}
        error={null}
      />
    );
  }
  render(<Filters />);
  expect(screen.getByLabelText("文章编号")).not.toBeVisible();
  fireEvent.change(screen.getByLabelText("标题"), {
    target: { value: "演示检索" },
  });
  expect(submit).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: /更多筛选/ }));
  fireEvent.change(screen.getByLabelText("文章编号"), {
    target: { value: "8101" },
  });
  await userEvent.click(screen.getByRole("button", { name: "搜索" }));
  expect(submit).toHaveBeenCalledWith(
    expect.objectContaining({ title: "演示检索", id: 8101 }),
  );
});
it("文章信息切换保留正文节点，元数据修改与失败均保留原 HTML", async () => {
  const save = vi.fn();
  function Editor() {
    const [input, setInput] = useState(articleInput(article));
    return (
      <MemoryRouter>
        <TooltipProvider>
          <EditorSheet
            input={input}
            classes={[{ id: 1, name: "社会" }]}
            classesError={null}
            retryClasses={vi.fn()}
            onChange={setInput}
            onClose={vi.fn()}
            onSave={() => save(input)}
            busy={false}
            uploading={false}
            onUploading={vi.fn()}
            error="【演示】保存失败，输入保留"
            onError={vi.fn()}
          />
        </TooltipProvider>
      </MemoryRouter>
    );
  }
  render(<Editor />);
  const body = await screen.findByRole("textbox", { name: "文章正文" });
  await userEvent.click(screen.getByRole("tab", { name: "文章信息" }));
  fireEvent.change(screen.getByLabelText("作者"), {
    target: { value: "修改后编辑" },
  });
  await userEvent.click(screen.getByRole("tab", { name: "正文" }));
  expect(screen.getByRole("textbox", { name: "文章正文" })).toBe(body);
  await userEvent.click(screen.getByRole("button", { name: "保存修改" }));
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({
      writer: "修改后编辑",
      newsText: article.newsText,
    }),
  );
  expect(screen.getByRole("alert")).toHaveTextContent("保存失败");
});
it("源码校验失败保留输入，取消不改正文，应用后一次撤销恢复原始 HTML", async () => {
  const save = vi.fn();
  function Editor() {
    const [input, setInput] = useState(articleInput(article));
    return (
      <MemoryRouter>
        <TooltipProvider>
          <EditorSheet
            input={input}
            classes={[]}
            classesError={null}
            retryClasses={vi.fn()}
            onChange={setInput}
            onClose={vi.fn()}
            onSave={() => save(input)}
            busy={false}
            uploading={false}
            onUploading={vi.fn()}
            error={null}
            onError={vi.fn()}
          />
        </TooltipProvider>
      </MemoryRouter>
    );
  }
  render(<Editor />);
  const open = await screen.findByRole("button", { name: "HTML 源码" });
  await userEvent.click(open);
  const source = await screen.findByRole("dialog", { name: "HTML 源码" });
  const invalid = '<p><img src="data:image/png;base64,AA=="></p>';
  fireEvent.change(within(source).getByLabelText("正文 HTML"), {
    target: { value: invalid },
  });
  await userEvent.click(
    within(source).getByRole("button", { name: "应用到正文" }),
  );
  expect(within(source).getByRole("alert")).toHaveTextContent("临时图片地址");
  expect(within(source).getByLabelText("正文 HTML")).toHaveValue(invalid);
  await userEvent.click(within(source).getByRole("button", { name: "取消" }));
  await userEvent.click(screen.getByRole("button", { name: "保存修改" }));
  expect(save.mock.lastCall?.[0].newsText).toBe(article.newsText);
  await userEvent.click(open);
  const next = await screen.findByRole("dialog", { name: "HTML 源码" });
  fireEvent.change(within(next).getByLabelText("正文 HTML"), {
    target: { value: "<p>【演示】通过源码修改。</p>" },
  });
  await userEvent.click(
    within(next).getByRole("button", { name: "应用到正文" }),
  );
  await waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "HTML 源码" }),
    ).not.toBeInTheDocument(),
  );
  expect(screen.getByRole("textbox", { name: "文章正文" })).toHaveTextContent(
    "通过源码修改",
  );
  await userEvent.click(screen.getByRole("button", { name: "撤销" }));
  await userEvent.click(screen.getByRole("button", { name: "保存修改" }));
  expect(save.mock.lastCall?.[0].newsText).toBe(article.newsText);
});
