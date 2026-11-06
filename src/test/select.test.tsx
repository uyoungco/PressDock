import { useState } from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { SearchableSelect } from "@/components/common/SearchableSelect";
import { Sheet, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { MaterialForm } from "@/features/channels/MaterialForm";
import { blankInput } from "@/features/channels/edit-buffer";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const options = [
  { value: "", label: "全部渠道" },
  { value: "news", label: "新闻频道" },
  { value: "kook", label: "KOOK" },
  { value: "sports", label: "体育频道" },
];

function SheetSelect() {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  return (
    <Sheet open>
      <SheetContent ref={setContainer} aria-describedby={undefined}>
        <SheetTitle>修改素材</SheetTitle>
        <SearchableSelect
          options={options}
          value="news"
          onValueChange={() => {}}
          aria-label="渠道"
          portalContainer={container}
        />
      </SheetContent>
    </Sheet>
  );
}

it.each(["mouse", "keyboard"])(
  "抽屉内以 %s 打开时聚焦搜索框，不请求浏览器滚动",
  async (method) => {
    const focus = vi.spyOn(HTMLElement.prototype, "focus");
    try {
      render(<SheetSelect />);
      const trigger = screen.getByLabelText("渠道");
      if (method === "mouse") await userEvent.click(trigger);
      else {
        trigger.focus();
        await userEvent.keyboard("{ArrowDown}");
      }
      const input = await screen.findByPlaceholderText("搜索选项…");
      await waitFor(() => expect(input).toHaveFocus());
      expect(input.closest('[data-slot="sheet-content"]')).not.toBeNull();
      const inputCalls = focus.mock.calls.filter(
        (_, index) => focus.mock.contexts[index] === input,
      );
      expect(inputCalls.length).toBeGreaterThan(0);
      expect(inputCalls.every(([options]) => options?.preventScroll)).toBe(
        true,
      );
      await userEvent.keyboard("{Escape}");
      await waitFor(() =>
        expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
      );
      expect(trigger).toHaveFocus();
    } finally {
      focus.mockRestore();
    }
  },
);

it("触摸打开时保留菜单焦点，不自动聚焦搜索框", async () => {
  render(<SheetSelect />);
  const trigger = screen.getByLabelText("渠道");
  await userEvent.pointer([
    { keys: "[TouchA>]", target: trigger },
    { keys: "[/TouchA]" },
  ]);
  const input = await screen.findByPlaceholderText("搜索选项…");
  const popup = input.closest('[data-slot="combobox-content"]');
  await waitFor(() => expect(popup).toHaveFocus());
  expect(input).not.toHaveFocus();
});

it.each(["channel-sheet", "dialog"] as const)(
  "%s 中 Esc 先收起渠道菜单并还原焦点，再次按下才关闭素材表单",
  async (presentation) => {
    const onClose = vi.fn();
    render(
      <MaterialForm
        edit={{ base: null, input: { ...blankInput(), channel: "news" } }}
        presentation={presentation}
        channels={{
          groups: [{ channel: "news", subchannels: ["头条"] }],
          loading: false,
          error: null,
          retry() {},
        }}
        onChange={() => {}}
        onSave={() => {}}
        onClose={onClose}
        busy={false}
        onUploading={() => {}}
        error={null}
      />,
    );
    const trigger = document.getElementById("material-channel")!;
    await userEvent.click(trigger);
    await screen.findByPlaceholderText("搜索选项…");
    await userEvent.keyboard("{Escape}");
    await waitFor(() =>
      expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(trigger).toHaveFocus();
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledOnce();
  },
);

it("搜索按中文和英文大小写过滤，搜索及关闭不改变选中值", async () => {
  const onValueChange = vi.fn();
  render(
    <SearchableSelect
      options={options}
      value="news"
      onValueChange={onValueChange}
      aria-label="渠道"
      searchPlaceholder="搜索渠道…"
    />,
  );
  const trigger = screen.getByLabelText("渠道");
  await userEvent.click(trigger);
  const input = await screen.findByPlaceholderText("搜索渠道…");
  expect(input).toHaveFocus();
  await userEvent.type(input, "频道");
  expect(screen.getAllByRole("option")).toHaveLength(2);
  await userEvent.clear(input);
  await userEvent.type(input, "kOo");
  expect(screen.getByRole("option", { name: "KOOK" })).toBeInTheDocument();
  expect(trigger).toHaveTextContent("新闻频道");
  expect(onValueChange).not.toHaveBeenCalled();
  await userEvent.keyboard("{Escape}");
  await waitFor(() =>
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
  );
  expect(trigger).toHaveFocus();
  await userEvent.click(trigger);
  expect(await screen.findByPlaceholderText("搜索渠道…")).toHaveValue("");
  expect(screen.getAllByRole("option")).toHaveLength(4);
});

it("无匹配项有明确提示，点击外部或按 Tab 离开不会提交选择", async () => {
  const onValueChange = vi.fn();
  render(
    <>
      <SearchableSelect
        options={options}
        value="news"
        onValueChange={onValueChange}
        aria-label="渠道"
      />
      <button>其他操作</button>
    </>,
  );
  await userEvent.click(screen.getByLabelText("渠道"));
  await userEvent.type(
    await screen.findByPlaceholderText("搜索选项…"),
    "不存在",
  );
  expect(screen.getByText("未找到匹配项")).toBeVisible();
  expect(screen.queryByRole("option")).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "其他操作" }));
  await waitFor(() =>
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
  );
  await userEvent.click(screen.getByLabelText("渠道"));
  await screen.findByPlaceholderText("搜索选项…");
  await userEvent.tab();
  await waitFor(() =>
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
  );
  expect(onValueChange).not.toHaveBeenCalled();
});

it("方向键和 Enter 选择选项，支持全部项的空字符串且不提交外层表单", async () => {
  const submit = vi.fn((event) => event.preventDefault());
  function Example() {
    const [value, setValue] = useState("");
    return (
      <form onSubmit={submit}>
        <SearchableSelect
          options={options}
          value={value}
          onValueChange={setValue}
          aria-label="渠道"
        />
        <button>提交</button>
      </form>
    );
  }
  render(<Example />);
  const trigger = screen.getByLabelText("渠道");
  await userEvent.click(trigger);
  await userEvent.type(await screen.findByPlaceholderText("搜索选项…"), "新闻");
  await userEvent.keyboard("{ArrowDown}{Enter}");
  await waitFor(() => expect(trigger).toHaveTextContent("新闻频道"));
  await waitFor(() =>
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
  );
  await userEvent.click(trigger);
  await userEvent.click(
    await screen.findByRole("option", { name: "全部渠道" }),
  );
  expect(trigger).toHaveTextContent("全部渠道");
  expect(submit).not.toHaveBeenCalled();
});

it("中文输入法确认期间 Enter 不选择选项或提交表单", async () => {
  const onValueChange = vi.fn();
  render(
    <SearchableSelect
      options={options}
      value=""
      onValueChange={onValueChange}
      aria-label="渠道"
    />,
  );
  await userEvent.click(screen.getByLabelText("渠道"));
  const input = await screen.findByPlaceholderText("搜索选项…");
  await waitFor(() => expect(input).toHaveFocus());
  fireEvent.compositionStart(input);
  fireEvent.change(input, { target: { value: "新闻" } });
  fireEvent.keyDown(input, { key: "ArrowDown" });
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  expect(onValueChange).not.toHaveBeenCalled();
  expect(screen.getByRole("listbox")).toBeVisible();
  fireEvent.compositionEnd(input);
  await userEvent.keyboard("{Enter}");
  expect(onValueChange).toHaveBeenCalledWith("news");
});

it("禁用时关闭已有弹层，恢复后搜索清空；历史值仍可回显", async () => {
  const onValueChange = vi.fn();
  const props = {
    options,
    value: "历史渠道",
    onValueChange,
    "aria-label": "渠道",
  };
  const { rerender } = render(<SearchableSelect {...props} />);
  const trigger = screen.getByLabelText("渠道");
  expect(trigger).toHaveTextContent("历史渠道");
  await userEvent.click(trigger);
  await userEvent.type(await screen.findByPlaceholderText("搜索选项…"), "koo");
  rerender(<SearchableSelect {...props} disabled />);
  expect(trigger).toBeDisabled();
  await waitFor(() =>
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
  );
  await userEvent.click(trigger);
  expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  rerender(<SearchableSelect {...props} />);
  await userEvent.click(trigger);
  expect(await screen.findByPlaceholderText("搜索选项…")).toHaveValue("");
  expect(screen.getByRole("option", { name: "历史渠道" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(onValueChange).not.toHaveBeenCalled();
});

it("普通 Select 显示映射标签并在禁用时收起弹层", async () => {
  const onValueChange = vi.fn();
  function Example({ disabled = false }) {
    return (
      <Select
        items={options}
        value="news"
        onValueChange={onValueChange}
        disabled={disabled}
      >
        <SelectTrigger aria-label="普通选择">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }
  const { rerender } = render(<Example />);
  expect(screen.getByLabelText("普通选择")).toHaveTextContent("新闻频道");
  await userEvent.click(screen.getByLabelText("普通选择"));
  expect(await screen.findByRole("listbox")).toBeInTheDocument();
  rerender(<Example disabled />);
  await waitFor(() =>
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument(),
  );
  expect(screen.getByLabelText("普通选择")).toBeDisabled();
  expect(onValueChange).not.toHaveBeenCalled();
});
