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
