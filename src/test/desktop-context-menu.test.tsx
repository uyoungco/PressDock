import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { EditorView } from "@tiptap/pm/view";
import { TooltipProvider } from "@/components/ui/tooltip";
import RichTextEditor from "@/features/cms-articles/RichTextEditor";
import { invalidateClientRequests } from "@/services/tauri/client";
import windowPolicySource from "../../src-tauri/src/window_policy.rs?raw";

// 执行桌面真正注入的脚本；仍在 jsdom 的 window 捕获阶段处理真实 DOM 事件。
const policyScript = windowPolicySource.match(
  /const SCRIPT: &str = r#"([\s\S]*?)"#;/,
)![1];
const listeners: (() => void)[] = [];
afterEach(() => listeners.splice(0).forEach((remove) => remove()));

function installPolicy(enabled: boolean, appMenus = true, topLevel = true) {
  const surface = {
    top: null as unknown,
    parent: null as unknown,
    frames: [],
    postMessage: vi.fn(),
    addEventListener(
      type: string,
      listener: EventListener,
      options?: boolean | AddEventListenerOptions,
    ) {
      window.addEventListener(type, listener, options);
      listeners.push(() => window.removeEventListener(type, listener, options));
    },
  };
  surface.top = topLevel ? surface : {};
  surface.parent = topLevel ? surface : { postMessage: vi.fn() };
  const initialize = new Function(
    "window",
    "Element",
    policyScript
      .replace("__PRESSDOCK_MENU_ENABLED__", String(enabled))
      .replace("__PRESSDOCK_APP_MENUS__", String(appMenus)),
  );
  initialize(surface, Element);
  return Reflect.get(surface, "__pressdockSetContextMenu") as (
    enabled: boolean,
  ) => void;
}

function editorForm(disabled = false) {
  return (
    <MemoryRouter>
      <TooltipProvider>
        <RichTextEditor
          initialHtml="<p>【演示数据】第一段。</p><p>【演示数据】第二段。</p>"
          title="【演示数据】桌面右键策略"
          disabled={disabled}
          onChange={vi.fn()}
          onUploading={vi.fn()}
          onError={vi.fn()}
        />
      </TooltipProvider>
    </MemoryRouter>
  );
}

it.each([false, true])(
  "开发者模式 %s 时正文业务菜单均能打开并插入分页",
  async (enabled) => {
    installPolicy(enabled);
    vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);
    vi.spyOn(EditorView.prototype, "coordsAtPos").mockReturnValue({
      left: 0,
      right: 1,
      top: 0,
      bottom: 1,
    });
    render(editorForm());
    const body = await screen.findByRole("textbox", { name: "文章正文" });
    fireEvent.contextMenu(body.querySelector("p")!);
    await userEvent.click(
      await screen.findByRole("menuitem", { name: "插入分页符" }),
    );
    await waitFor(() =>
      expect(body.querySelectorAll(".cms-page-break")).toHaveLength(1),
    );
  },
);

it("关闭开发者模式仍拦截正文以外的原生菜单，开关即时生效", () => {
  const setEnabled = installPolicy(false);
  const contextMenu = vi.fn();
  render(<input aria-label="演示普通输入" onContextMenu={contextMenu} />);
  const input = screen.getByLabelText("演示普通输入");
  expect(fireEvent.contextMenu(input)).toBe(false);
  expect(contextMenu).not.toHaveBeenCalled();
  setEnabled(true);
  expect(fireEvent.contextMenu(input)).toBe(true);
  expect(contextMenu).toHaveBeenCalledTimes(1);
  setEnabled(false);
  expect(fireEvent.contextMenu(input)).toBe(false);
  expect(contextMenu).toHaveBeenCalledTimes(1);
});

it.each([
  { name: "采集来源窗口", appMenus: false, topLevel: true },
  { name: "主窗口内的 iframe", appMenus: true, topLevel: false },
])("$name 不能用正文菜单标记绕过原生菜单限制", ({ appMenus, topLevel }) => {
  installPolicy(false, appMenus, topLevel);
  const contextMenu = vi.fn();
  render(
    <div data-pressdock-context-menu="article-body" onContextMenu={contextMenu}>
      演示来源内容
    </div>,
  );
  expect(fireEvent.contextMenu(screen.getByText("演示来源内容"))).toBe(false);
  expect(contextMenu).not.toHaveBeenCalled();
});

it("禁用和会话失效时移除菜单放行标记，恢复编辑也不会重新打开旧菜单", async () => {
  installPolicy(false);
  const { rerender } = render(editorForm());
  const body = await screen.findByRole("textbox", { name: "文章正文" });
  expect(
    body.closest('[data-pressdock-context-menu="article-body"]'),
  ).not.toBeNull();
  rerender(editorForm(true));
  expect(body.closest("[data-pressdock-context-menu]")).toBeNull();
  fireEvent.contextMenu(body.querySelector("p")!);
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  rerender(editorForm());
  expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  expect(
    body.closest('[data-pressdock-context-menu="article-body"]'),
  ).not.toBeNull();
  act(() => invalidateClientRequests());
  expect(body.closest("[data-pressdock-context-menu]")).toBeNull();
});
