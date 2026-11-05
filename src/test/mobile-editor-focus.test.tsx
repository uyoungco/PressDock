import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { MobileEditor } from "@/features/settings/MobileEditor";
import { MobileSettingsContext } from "@/features/settings/mobile-state";

it("设置编辑打开时聚焦容器，输入框支持手动点击和 Tab 导航", async () => {
  const closeEditor = vi.fn();
  const save = vi.fn();
  render(
    <MobileSettingsContext.Provider
      value={{
        editor: { kind: "template", id: "demo-template" },
        providerId: null,
        purpose: "title",
        openEditor: vi.fn(),
        closeEditor,
        selectProvider: vi.fn(),
        changePurpose: vi.fn(),
        report: vi.fn(),
      }}
    >
      <MobileEditor
        title="演示模板编辑"
        formId="demo-form"
        busy={false}
        error={null}
      >
        <form id="demo-form" onSubmit={save}>
          <input aria-label="演示名称" defaultValue="演示模板" />
        </form>
      </MobileEditor>
    </MobileSettingsContext.Provider>,
  );
  const dialog = screen.getByRole("dialog", { name: "演示模板编辑" });
  const input = screen.getByRole("textbox", { name: "演示名称" });
  await waitFor(() => expect(dialog).toHaveFocus());
  expect(input).not.toHaveFocus();
  await userEvent.tab();
  expect(screen.getAllByRole("button", { name: "返回列表" })[0]).toHaveFocus();
  await userEvent.tab();
  expect(input).toHaveFocus();
  await userEvent.click(screen.getByRole("heading"));
  await userEvent.click(input);
  expect(input).toHaveFocus();
  expect(input).toHaveValue("演示模板");
  expect(save).not.toHaveBeenCalled();
});
