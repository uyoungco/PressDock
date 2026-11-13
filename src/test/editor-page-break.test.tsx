import { Editor } from "@tiptap/core";
import { NodeSelection, TextSelection } from "@tiptap/pm/state";
import { EditorView } from "@tiptap/pm/view";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  editorExtensions,
  parseCompatible,
  prepareHtml,
} from "@/features/cms-articles/editor-content";
import {
  deletePageBreakAt,
  pageBreak,
  readPageBreaks,
} from "@/features/cms-articles/editor-page-break";
import RichTextEditor from "@/features/cms-articles/RichTextEditor";
import { invalidateClientRequests } from "@/services/tauri/client";
import * as platform from "@/lib/platform";
import { articleService } from "@/features/cms-articles/service";
import { deferred } from "./cms-fixtures";

const marker = `<p>${pageBreak}</p>`;
const first =
  '<p style="text-align: center"><strong>【演示数据】第一页。</strong></p>';
const last =
  '<p><a href="https://example.com/">第二页。</a><img src="https://example.com/demo.png" alt="演示图片" width="120"></p>';
const original = first + marker + last;
const editors: Editor[] = [];

beforeEach(() => {
  vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);
  vi.spyOn(EditorView.prototype, "coordsAtPos").mockReturnValue({
    left: 0,
    right: 1,
    top: 0,
    bottom: 1,
  });
  vi.spyOn(EditorView.prototype, "endOfTextblock").mockImplementation(function (
    this: EditorView,
    direction,
  ) {
    const cursor = this.state.selection.$from;
    return direction === "backward"
      ? cursor.parentOffset === 0
      : cursor.parentOffset === cursor.parent.content.size;
  });
});
afterEach(() => {
  editors.splice(0).forEach((editor) => {
    const element = editor.options.element;
    editor.destroy();
    if (element instanceof HTMLElement) element.remove();
  });
});

function mountEditor(html = original) {
  const element = document.createElement("div");
  document.body.append(element);
  const editor = new Editor({
    element,
    extensions: editorExtensions,
    content: parseCompatible(prepareHtml(html).body).toJSON(),
    injectCSS: false,
  });
  editors.push(editor);
  return editor;
}

function select(editor: Editor, from: number, to = from) {
  editor.view.dispatch(
    editor.state.tr.setSelection(
      TextSelection.create(editor.state.doc, from, to),
    ),
  );
}
const buttons = (editor: Editor) =>
  Array.from(editor.view.dom.querySelectorAll<HTMLButtonElement>("button"));

describe("分页整行删除", () => {
  it.each(["Backspace", "Delete"])(
    "%s 从相邻正文直接删除分页，保留段落和图文格式",
    (key) => {
      const editor = mountEditor();
      const baseline = editor.state.doc;
      const item = readPageBreaks(baseline)[0];
      select(
        editor,
        key === "Backspace" ? item.position + item.size + 1 : item.position - 1,
      );
      fireEvent.keyDown(editor.view.dom, { key });
      expect(readPageBreaks(editor.state.doc)).toHaveLength(0);
      expect(editor.state.doc.childCount).toBe(2);
      expect(editor.state.doc.child(0).eq(baseline.child(0))).toBe(true);
      expect(editor.state.doc.child(1).eq(baseline.child(2))).toBe(true);
      expect(
        editor.state.selection.$from.parent.eq(
          editor.state.doc.child(key === "Backspace" ? 1 : 0),
        ),
      ).toBe(true);
      expect(editor.view.hasFocus()).toBe(true);
      expect(editor.getHTML()).not.toContain(pageBreak);
    },
  );

  it.each(["node", "text", "partial"])(
    "%s 选区涉及分页标记时完整删除，不留下残片",
    (mode) => {
      const editor = mountEditor();
      const { position, size } = readPageBreaks(editor.state.doc)[0];
      if (mode === "node")
        editor.view.dispatch(
          editor.state.tr.setSelection(
            NodeSelection.create(editor.state.doc, position),
          ),
        );
      else
        select(
          editor,
          position + 1,
          position + (mode === "text" ? size - 1 : 6),
        );
      fireEvent.keyDown(editor.view.dom, { key: "Delete" });
      expect(editor.state.doc.childCount).toBe(2);
      expect(editor.getHTML()).not.toMatch(/empirenews|\[!--|--\]/);
    },
  );

  it("点击按钮不删除当前其他选区，编辑移动分页后仍删除正确位置并更新页码", () => {
    const editor = mountEditor(
      first + marker + "<p>中间页。</p>" + marker + last,
    );
    const secondButton = buttons(editor)[1];
    editor.commands.insertContentAt(1, "新增文字");
    select(editor, 1, 4);
    fireEvent.click(secondButton);
    expect(readPageBreaks(editor.state.doc)).toHaveLength(1);
    expect(editor.state.doc.textContent).toContain("新增文字");
    expect(editor.state.doc.textContent).toContain("中间页。");
    expect(buttons(editor)[0]).toHaveAccessibleName("删除第 1 页后的分页");
    expect(editor.view.dom.querySelector(".cms-page-break")).toHaveAttribute(
      "data-page-label",
      "第 1 页 / 第 2 页",
    );
    fireEvent.click(buttons(editor)[0]);
    expect(readPageBreaks(editor.state.doc)).toHaveLength(0);
    expect(editor.state.doc.childCount).toBe(3);
  });

  it("连续分页删除后光标落在正文，每次删除都可单独撤销/重做且与输入隔离", () => {
    const editor = mountEditor(first + marker + marker + last);
    const baseline = editor.state.doc;
    editor.commands.insertContentAt(1, "新增");
    const typed = editor.state.doc;
    fireEvent.click(buttons(editor)[0]);
    const once = editor.state.doc;
    expect(editor.state.selection.$from.parent.textContent).toBe("第二页。");
    fireEvent.click(buttons(editor)[0]);
    expect(readPageBreaks(editor.state.doc)).toHaveLength(0);
    editor.commands.undo();
    expect(editor.state.doc.eq(once)).toBe(true);
    editor.commands.undo();
    expect(editor.state.doc.eq(typed)).toBe(true);
    editor.commands.undo();
    expect(editor.state.doc.eq(baseline)).toBe(true);
    editor.commands.redo();
    editor.commands.redo();
    editor.commands.redo();
    expect(readPageBreaks(editor.state.doc)).toHaveLength(0);
  });

  it.each([marker + last, first + marker, marker])(
    "文首、文末或仅有分页也可删除：%s",
    (html) => {
      const editor = mountEditor(html);
      fireEvent.click(buttons(editor)[0]);
      expect(readPageBreaks(editor.state.doc)).toHaveLength(0);
      expect(editor.state.doc.childCount).toBe(1);
    },
  );

  it.each(["Backspace", "Delete"])(
    "普通文字选区与普通段落边界的 %s 保持默认行为",
    (key) => {
      const editor = mountEditor("<p>演示甲乙</p><p>丙丁</p>" + marker + last);
      select(editor, 3, 4);
      fireEvent.keyDown(editor.view.dom, { key });
      expect(editor.state.doc.child(0).textContent).toBe("演示乙");
      const boundary = editor.state.doc.child(0).nodeSize;
      select(editor, key === "Backspace" ? boundary + 1 : boundary - 1);
      fireEvent.keyDown(editor.view.dom, { key });
      expect(editor.state.doc.child(0).textContent).toBe("演示乙丙丁");
      expect(readPageBreaks(editor.state.doc)).toHaveLength(1);
    },
  );

  it("相邻引用中的正文边界可删除顶层分页，引用结构保持完整", () => {
    const editor = mountEditor(
      first + marker + "<blockquote><p>演示引用。</p></blockquote>",
    );
    const item = readPageBreaks(editor.state.doc)[0];
    select(editor, item.position + item.size + 2);
    fireEvent.keyDown(editor.view.dom, { key: "Backspace" });
    expect(readPageBreaks(editor.state.doc)).toHaveLength(0);
    expect(editor.state.doc.child(1).type.name).toBe("blockquote");
  });

  it("装饰与按钮不进入序列化正文，编辑器只读切换即时禁用按钮和删除逻辑", () => {
    const editor = mountEditor();
    const html = editor.getHTML();
    expect(html).toContain(pageBreak);
    expect(html).not.toMatch(/button|cms-page-break|删除分页|data-page-label/);
    const position = readPageBreaks(editor.state.doc)[0].position;
    editor.setEditable(false, false);
    expect(buttons(editor)[0]).toBeDisabled();
    expect(deletePageBreakAt(editor.view, position)).toBe(false);
    fireEvent.click(buttons(editor)[0]);
    expect(editor.getHTML()).toBe(html);
    editor.setEditable(true, false);
    expect(buttons(editor)[0]).toBeEnabled();
    fireEvent.click(buttons(editor)[0]);
    expect(editor.getHTML()).not.toContain(pageBreak);
  });

  it("嵌套分页继续保护，按钮和键盘均不能破坏或展开标记", () => {
    const editor = mountEditor(
      first +
        marker +
        "<blockquote>" +
        marker +
        "<p>嵌套演示正文。</p></blockquote>",
    );
    const baseline = editor.state.doc;
    expect(buttons(editor).every((button) => button.disabled)).toBe(true);
    for (const item of readPageBreaks(baseline)) {
      select(editor, item.position + item.size + 1);
      fireEvent.keyDown(editor.view.dom, { key: "Backspace" });
      expect(editor.state.doc.eq(baseline)).toBe(true);
      expect(deletePageBreakAt(editor.view, item.position)).toBe(false);
    }
  });
});

function editorForm(
  onChange: (html: string) => void,
  disabled = false,
  html = original,
) {
  return (
    <MemoryRouter>
      <TooltipProvider>
        <RichTextEditor
          initialHtml={html}
          title="演示文章"
          disabled={disabled}
          onChange={onChange}
          onUploading={vi.fn()}
          onError={vi.fn()}
        />
      </TooltipProvider>
    </MemoryRouter>
  );
}

it("表单删除仅回传正文，一次撤销恢复原始 HTML 字节，重做删除", async () => {
  const onChange = vi.fn();
  render(editorForm(onChange));
  const button = await screen.findByRole("button", {
    name: "删除第 1 页后的分页",
  });
  expect(onChange).not.toHaveBeenCalled();
  await userEvent.click(button);
  await waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
  expect(onChange.mock.lastCall?.[0]).not.toMatch(
    /empirenews|button|cms-page-break|删除分页/,
  );
  await userEvent.click(screen.getByRole("button", { name: "撤销" }));
  await waitFor(() => expect(onChange.mock.lastCall?.[0]).toBe(original));
  await userEvent.click(screen.getByRole("button", { name: "重做" }));
  await waitFor(() =>
    expect(onChange.mock.lastCall?.[0]).not.toContain(pageBreak),
  );
});

it("表单禁用和会话失效时分页按钮不可删除", async () => {
  const onChange = vi.fn();
  const { rerender } = render(editorForm(onChange));
  const button = await screen.findByRole("button", {
    name: "删除第 1 页后的分页",
  });
  rerender(editorForm(onChange, true));
  await waitFor(() => expect(button).toBeDisabled());
  fireEvent.click(button);
  expect(onChange).not.toHaveBeenCalled();
  rerender(editorForm(onChange));
  await waitFor(() => expect(button).toBeEnabled());
  act(() => invalidateClientRequests());
  await waitFor(() => expect(button).toBeDisabled());
  fireEvent.click(button);
  expect(onChange).not.toHaveBeenCalled();
});

it("不兼容正文进入保护模式，不出现可编辑分页按钮", async () => {
  const onChange = vi.fn();
  render(
    editorForm(
      onChange,
      false,
      original + "<table><tbody><tr><td>演示</td></tr></tbody></table>",
    ),
  );
  await screen.findByText("正文已保护，暂不可编辑");
  expect(
    screen.queryByRole("button", { name: "删除第 1 页后的分页" }),
  ).not.toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
});

const paginationShortcuts = [
  { name: "F8", event: { key: "F8" } },
  {
    name: "Ctrl+Shift+Enter",
    event: { key: "Enter", ctrlKey: true, shiftKey: true },
  },
];

async function focusBody(from = 2, to = from) {
  const body = await screen.findByRole("textbox", { name: "文章正文" });
  const editor = (body as HTMLElement & { editor: Editor }).editor;
  act(() => {
    select(editor, from, to);
    editor.view.focus();
  });
  return { body, editor };
}

it.each(paginationShortcuts)(
  "$name 在选区所在内容块后分页，保留格式和选中文字，可独立撤销重做",
  async ({ event }) => {
    const html = first + last;
    const onChange = vi.fn();
    render(editorForm(onChange, false, html));
    const { body, editor } = await focusBody(2, 5);
    const baseline = editor.state.doc;
    expect(fireEvent.keyDown(body, event)).toBe(false);
    expect(readPageBreaks(editor.state.doc)).toHaveLength(1);
    expect(editor.state.doc.child(0).eq(baseline.child(0))).toBe(true);
    expect(editor.state.doc.child(2).eq(baseline.child(1))).toBe(true);
    expect(editor.state.selection.$from.index(0)).toBe(2);
    expect(onChange).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(onChange.mock.lastCall?.[0]).toBe(html);
    await userEvent.click(screen.getByRole("button", { name: "重做" }));
    expect(readPageBreaks(editor.state.doc)).toHaveLength(1);
  },
);

it.each(paginationShortcuts)(
  "$name 不在已有分页旁或文章末尾创建空页",
  async ({ event }) => {
    const onChange = vi.fn();
    render(editorForm(onChange));
    const { body, editor } = await focusBody();
    const baseline = editor.state.doc;
    fireEvent.keyDown(body, event);
    act(() => select(editor, baseline.content.size - 1));
    fireEvent.keyDown(body, event);
    expect(editor.state.doc.eq(baseline)).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  },
);

it.each(paginationShortcuts)(
  "$name 忽略输入法、长按及未聚焦正文，并遵守禁用和会话保护",
  async ({ event }) => {
    const onChange = vi.fn();
    const html = first + last;
    const { rerender } = render(editorForm(onChange, false, html));
    const { body, editor } = await focusBody();
    const baseline = editor.state.doc;
    fireEvent.keyDown(body, { ...event, isComposing: true });
    fireEvent.keyDown(body, { ...event, keyCode: 229 });
    fireEvent.keyDown(body, { ...event, repeat: true });
    act(() => body.blur());
    fireEvent.keyDown(body, event);
    rerender(editorForm(onChange, true, html));
    act(() => editor.view.focus());
    fireEvent.keyDown(body, event);
    rerender(editorForm(onChange, false, html));
    act(() => invalidateClientRequests());
    fireEvent.keyDown(body, event);
    expect(editor.state.doc.eq(baseline)).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  },
);

it.each([
  { key: "Enter", ctrlKey: true },
  { key: "Enter", shiftKey: true },
])("原有换行组合 $ctrlKey / $shiftKey 保留换行功能", async (event) => {
  const onChange = vi.fn();
  render(editorForm(onChange, false, first + last));
  const { body, editor } = await focusBody();
  fireEvent.keyDown(body, event);
  expect(onChange.mock.lastCall?.[0]).toContain("<br>");
  expect(readPageBreaks(editor.state.doc)).toHaveLength(0);
});

describe("正文右键分页", () => {
  it("按右击块而非原选区插入，保留正文且支持一次撤销重做", async () => {
    const html = first + "<p><em>【演示数据】右击这一段。</em></p>" + last;
    const onChange = vi.fn();
    render(editorForm(onChange, false, html));
    const { body, editor } = await focusBody(2, 5);
    const baseline = editor.state.doc;
    fireEvent.contextMenu(body.querySelector("em")!, {
      clientX: 50,
      clientY: 80,
    });
    const item = await screen.findByRole("menuitem", { name: "插入分页符" });
    expect(item).toHaveTextContent("F8 / Ctrl+Shift+Enter");
    expect(item).toHaveAttribute("aria-keyshortcuts", "F8 Control+Shift+Enter");
    expect(onChange).not.toHaveBeenCalled();
    await userEvent.click(item);
    expect(readPageBreaks(editor.state.doc)[0].position).toBe(
      baseline.child(0).nodeSize + baseline.child(1).nodeSize,
    );
    for (let i = 0; i < 3; i++)
      expect(
        editor.state.doc.child(i < 2 ? i : i + 1).eq(baseline.child(i)),
      ).toBe(true);
    expect(onChange).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(body).toHaveFocus());
    await userEvent.click(screen.getByRole("button", { name: "撤销" }));
    expect(onChange.mock.lastCall?.[0]).toBe(html);
    await userEvent.click(screen.getByRole("button", { name: "重做" }));
    expect(readPageBreaks(editor.state.doc)).toHaveLength(1);
  });

  it.each([
    {
      name: "图片及连续图注",
      content:
        '<p><img src="https://example.com/demo.png" alt="演示图片"></p><p class="img-caption">演示图注</p><p class="img-caption">演示补充图注</p>',
      selector: "img",
      blocks: 3,
    },
    {
      name: "嵌套列表",
      content:
        "<ul><li><p>演示列表</p><ul><li><p>演示子项</p></li></ul></li></ul>",
      selector: "li li p",
      blocks: 1,
    },
    {
      name: "引用",
      content: "<blockquote><p>演示引语</p><p>演示引语续段</p></blockquote>",
      selector: "blockquote p",
      blocks: 1,
    },
    { name: "分隔线", content: "<hr>", selector: "hr", blocks: 1 },
  ])("$name 按完整顶层内容组分页", async ({ content, selector, blocks }) => {
    const onChange = vi.fn();
    render(editorForm(onChange, false, first + content + last));
    const { body, editor } = await focusBody();
    const baseline = editor.state.doc;
    fireEvent.contextMenu(body.querySelector(selector)!);
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "插入分页符" }),
    );
    let expected = 0;
    for (let i = 0; i <= blocks; i++) expected += baseline.child(i).nodeSize;
    expect(readPageBreaks(editor.state.doc)[0].position).toBe(expected);
    for (let i = 0; i < baseline.childCount; i++)
      expect(
        editor.state.doc.child(i <= blocks ? i : i + 1).eq(baseline.child(i)),
      ).toBe(true);
  });

  it.each([
    { name: "分页前", html: original, selector: "p:first-child" },
    { name: "分页标记", html: original, selector: ".cms-page-break" },
    { name: "文末", html: first + last, selector: "p:last-child" },
    {
      name: "嵌套分页",
      html: first + `<blockquote>${marker}</blockquote>` + last,
      selector: "p:first-child",
    },
  ])("$name 不产生空页或额外分页", async ({ html, selector }) => {
    const onChange = vi.fn();
    render(editorForm(onChange, false, html));
    const { body, editor } = await focusBody();
    const baseline = editor.state.doc;
    fireEvent.contextMenu(body.querySelector(selector)!);
    const item = await screen.findByRole("menuitem", { name: "插入分页符" });
    expect(item).toHaveAttribute("aria-disabled", "true");
    fireEvent.click(item);
    expect(editor.state.doc.eq(baseline)).toBe(true);
    expect(onChange).not.toHaveBeenCalled();
  });

  it("无法命中正文时置灰，不回退到原光标", async () => {
    const onChange = vi.fn();
    render(editorForm(onChange, false, first + last));
    const { body } = await focusBody();
    vi.spyOn(EditorView.prototype, "posAtCoords").mockReturnValue(null);
    fireEvent.contextMenu(body);
    expect(
      await screen.findByRole("menuitem", { name: "插入分页符" }),
    ).toHaveAttribute("aria-disabled", "true");
    expect(onChange).not.toHaveBeenCalled();
  });

  it.each(["锁定", "会话失效", "正文变化"])(
    "菜单打开后%s立即关闭，不再使用旧位置",
    async (reason) => {
      const onChange = vi.fn();
      const html = first + last;
      const { rerender } = render(editorForm(onChange, false, html));
      const { body, editor } = await focusBody();
      fireEvent.contextMenu(body.querySelector("p")!);
      await screen.findByRole("menuitem", { name: "插入分页符" });
      if (reason === "锁定") rerender(editorForm(onChange, true, html));
      else if (reason === "会话失效") act(() => invalidateClientRequests());
      else
        act(() => {
          editor.commands.insertContent("【演示】正文已变化");
        });
      await waitFor(() =>
        expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
      );
      if (reason === "锁定") {
        rerender(editorForm(onChange, false, html));
        expect(screen.queryByRole("menu")).not.toBeInTheDocument();
      }
      expect(readPageBreaks(editor.state.doc)).toHaveLength(0);
      if (reason !== "正文变化") expect(onChange).not.toHaveBeenCalled();
    },
  );

  it("图片上传期间关闭菜单并禁止再次打开", async () => {
    const pending =
      deferred<Awaited<ReturnType<typeof articleService.upload>>>();
    vi.spyOn(articleService, "upload").mockReturnValue(pending.promise);
    const onChange = vi.fn();
    render(editorForm(onChange, false, first + last));
    const { body } = await focusBody();
    fireEvent.contextMenu(body.querySelector("p")!);
    await screen.findByRole("menu");
    fireEvent.paste(body, {
      clipboardData: {
        getData: () => "",
        items: [],
        files: [new File(["演示图片"], "demo.png", { type: "image/png" })],
      },
    });
    await waitFor(() => expect(articleService.upload).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    fireEvent.contextMenu(body.querySelector("p")!);
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    await act(async () => {
      pending.reject(new Error("【演示】上传未完成"));
      await pending.promise.catch(() => undefined);
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it("取消不修改正文，点击外部控件保持其焦点和点击行为", async () => {
    const onChange = vi.fn(),
      outsideClick = vi.fn();
    render(
      <>
        {editorForm(onChange, false, first + last)}
        <button onClick={outsideClick}>演示外部操作</button>
      </>,
    );
    const { body } = await focusBody();
    fireEvent.contextMenu(body.querySelector("p")!);
    const menu = await screen.findByRole("menu");
    fireEvent.keyDown(menu, { key: "Escape" });
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
    );
    expect(body).toHaveFocus();
    fireEvent.contextMenu(body.querySelector("p")!);
    await screen.findByRole("menu");
    const outside = screen.getByRole("button", { name: "演示外部操作" });
    await userEvent.click(outside);
    await waitFor(() =>
      expect(screen.queryByRole("menu")).not.toBeInTheDocument(),
    );
    expect(outsideClick).toHaveBeenCalledTimes(1);
    expect(outside).toHaveFocus();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("正文外、保护模式和 Android 不启用菜单", async () => {
    const onChange = vi.fn();
    const { rerender, unmount } = render(
      editorForm(onChange, false, first + last),
    );
    await focusBody();
    fireEvent.contextMenu(screen.getByRole("toolbar", { name: "正文工具栏" }));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    rerender(editorForm(onChange, true, first + last));
    fireEvent.contextMenu(
      screen.getByRole("textbox", { name: "文章正文" }).querySelector("p")!,
    );
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    unmount();
    const protectedForm = render(
      editorForm(
        onChange,
        false,
        "<table><tr><td>【演示】保护正文</td></tr></table>",
      ),
    );
    fireEvent.contextMenu(await screen.findByLabelText("正文只读预览"));
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    protectedForm.unmount();
    vi.spyOn(platform, "isAndroid").mockReturnValue(true);
    render(editorForm(onChange, false, first + last));
    const body = await screen.findByRole("textbox", { name: "文章正文" });
    fireEvent.contextMenu(body.querySelector("p")!);
    expect(body.closest('[data-slot="context-menu-trigger"]')).toBeNull();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });
});
