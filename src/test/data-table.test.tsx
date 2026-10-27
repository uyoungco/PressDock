import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { Provider } from "jotai";
import { ArticleTable } from "@/components/common/ArticleTable";
import { articleSchema } from "@/types/article";
import demoArticles from "@/features/articles/demo-articles.json";
import {
  columnStorageKey,
  type TablePreferenceKey,
} from "@/hooks/use-column-preferences";

const articles = articleSchema.array().parse(demoArticles);
function setup(key: Exclude<TablePreferenceKey, "channels"> = "articles") {
  return render(
    <Provider>
      <MemoryRouter>
        <ArticleTable articles={articles} preferenceKey={key} />
      </MemoryRouter>
    </Provider>,
  );
}
const table = () => within(screen.getByRole("table", { name: "文章列表" }));

describe("Dice UI Data Table 列配置", () => {
  it("空状态不被宽表格挤出视口，仍可配置与恢复默认", async () => {
    render(
      <Provider>
        <MemoryRouter>
          <ArticleTable articles={[]} preferenceKey="articles" />
        </MemoryRouter>
      </Provider>,
    );
    expect(screen.getByRole("status")).toHaveTextContent("暂无符合条件的文章");
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "列配置" }));
    await userEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "来源" }),
    );
    await userEvent.click(screen.getByRole("menuitem", { name: "恢复默认" }));
    expect(screen.getByRole("status")).toHaveTextContent("暂无符合条件的文章");
    expect(
      JSON.parse(localStorage.getItem(columnStorageKey("articles"))!),
    ).toEqual({
      version: 1,
      visibility: {},
      sizing: {},
    });
  });
  it.each(["dashboard", "articles", "publish"] as const)(
    "%s 的显隐和列宽可在重新挂载后恢复，并能恢复默认",
    async (key) => {
      const view = setup(key);
      expect(table().getAllByRole("row")).toHaveLength(articles.length + 1);
      expect(table().getAllByText("演示")).toHaveLength(articles.length);
      expect(table().getByText(articles[0].title)).toBeInTheDocument();
      expect(table().queryByRole("link")).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "列配置" }));
      expect(
        screen.getByRole("menuitemcheckbox", { name: "文章标题" }),
      ).toHaveAttribute("aria-disabled", "true");
      await userEvent.click(
        screen.getByRole("menuitemcheckbox", { name: "来源" }),
      );
      await userEvent.keyboard("{Escape}");
      expect(
        table().queryByRole("columnheader", { name: "来源" }),
      ).not.toBeInTheDocument();
      const resize = screen.getByRole("separator", {
        name: "调整 文章标题 列宽",
      });
      resize.focus();
      await userEvent.keyboard("{ArrowRight}{ArrowRight}");
      expect(resize).toHaveAttribute("aria-valuenow", "380");
      const stored = JSON.parse(localStorage.getItem(columnStorageKey(key))!);
      expect(stored).toEqual({
        version: 1,
        visibility: { source: false },
        sizing: { title: 380 },
      });
      expect(JSON.stringify(stored)).not.toContain(articles[0].title);
      view.unmount();
      const restored = setup(key);
      expect(
        table().queryByRole("columnheader", { name: "来源" }),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole("separator", { name: "调整 文章标题 列宽" }),
      ).toHaveAttribute("aria-valuenow", "380");
      await userEvent.click(screen.getByRole("button", { name: "列配置" }));
      await userEvent.click(screen.getByRole("menuitem", { name: "恢复默认" }));
      expect(
        table().getByRole("columnheader", { name: "来源" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("separator", { name: "调整 文章标题 列宽" }),
      ).toHaveAttribute("aria-valuenow", "360");
      restored.unmount();
    },
  );

  it("三个文章页面与渠道页面分别保存偏好", async () => {
    localStorage.setItem(
      columnStorageKey("channels"),
      JSON.stringify({
        version: 1,
        visibility: { writer: false },
        sizing: { title: 420 },
      }),
    );
    const first = setup("articles");
    await userEvent.click(screen.getByRole("button", { name: "列配置" }));
    await userEvent.click(
      screen.getByRole("menuitemcheckbox", { name: "来源" }),
    );
    first.unmount();
    for (const key of ["dashboard", "publish"] as const) {
      const next = setup(key);
      expect(
        table().getByRole("columnheader", { name: "来源" }),
      ).toBeInTheDocument();
      next.unmount();
    }
    expect(
      JSON.parse(localStorage.getItem(columnStorageKey("channels"))!),
    ).toEqual({
      version: 1,
      visibility: { writer: false },
      sizing: { title: 420 },
    });
    setup("articles");
    expect(
      table().queryByRole("columnheader", { name: "来源" }),
    ).not.toBeInTheDocument();
  });

  it.each([
    "not json",
    JSON.stringify({ version: 2, visibility: { source: false } }),
    "null",
  ])("无效的持久化内容安全回退：%s", (stored) => {
    localStorage.setItem(columnStorageKey("articles"), stored);
    setup();
    expect(
      table().getByRole("columnheader", { name: "来源" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("separator", { name: "调整 文章标题 列宽" }),
    ).toHaveAttribute("aria-valuenow", "360");
  });

  it("恢复时忽略未知列、强制显示必需列并约束宽度", async () => {
    localStorage.setItem(
      columnStorageKey("articles"),
      JSON.stringify({
        version: 1,
        visibility: {
          title: false,
          actions: false,
          source: false,
          unknown: false,
        },
        sizing: {
          title: 999999,
          createdAt: -20,
          updatedAt: "wide",
          unknown: 100,
        },
        content: "不应保留的字段",
      }),
    );
    setup();
    expect(
      table().getByRole("columnheader", { name: "文章标题" }),
    ).toBeInTheDocument();
    expect(
      table().queryByRole("columnheader", { name: "操作" }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("separator", { name: "调整 文章标题 列宽" }),
    ).toHaveAttribute("aria-valuenow", "960");
    expect(
      screen.getByRole("separator", { name: "调整 创建时间 列宽" }),
    ).toHaveAttribute("aria-valuenow", "128");
    const updated = screen.getByRole("separator", {
      name: "调整 更新时间 列宽",
    });
    expect(updated).toHaveAttribute("aria-valuenow", "176");
    updated.focus();
    await userEvent.keyboard("{ArrowRight}");
    expect(
      JSON.parse(localStorage.getItem(columnStorageKey("articles"))!),
    ).toEqual({
      version: 1,
      visibility: { source: false },
      sizing: { title: 960, createdAt: 128, updatedAt: 186 },
    });
  });

  it("指针拖动、边界限制、取消及键盘重置均可用", async () => {
    setup();
    const resize = screen.getByRole("separator", { name: "调整 来源 列宽" });
    const pointer = (type: string, x: number) =>
      fireEvent(
        resize,
        new MouseEvent(type, { bubbles: true, button: 0, clientX: x }),
      );
    pointer("pointerdown", 100);
    pointer("pointermove", 150);
    expect(resize).toHaveAttribute("aria-valuenow", "250");
    pointer("pointerup", 160);
    expect(resize).toHaveAttribute("aria-valuenow", "260");
    pointer("pointerdown", 100);
    pointer("pointermove", -1000);
    expect(resize).toHaveAttribute("aria-valuenow", "120");
    pointer("pointercancel", 0);
    pointer("pointermove", 1000);
    expect(resize).toHaveAttribute("aria-valuenow", "120");
    resize.focus();
    await userEvent.keyboard("{Home}{Shift>}{ArrowRight}{/Shift}");
    expect(resize).toHaveAttribute("aria-valuenow", "250");
    fireEvent.doubleClick(resize);
    expect(resize).toHaveAttribute("aria-valuenow", "200");
  });

  it("存储读写异常时仍可在内存中调整和重置", async () => {
    const get = vi
      .spyOn(Storage.prototype, "getItem")
      .mockImplementation(() => {
        throw new Error("unavailable");
      });
    const set = vi
      .spyOn(Storage.prototype, "setItem")
      .mockImplementation(() => {
        throw new Error("unavailable");
      });
    try {
      setup();
      await userEvent.click(screen.getByRole("button", { name: "列配置" }));
      await userEvent.click(
        screen.getByRole("menuitemcheckbox", { name: "来源" }),
      );
      await userEvent.keyboard("{Escape}");
      expect(
        table().queryByRole("columnheader", { name: "来源" }),
      ).not.toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: "列配置" }));
      await userEvent.click(screen.getByRole("menuitem", { name: "恢复默认" }));
      expect(
        table().getByRole("columnheader", { name: "来源" }),
      ).toBeInTheDocument();
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
});
