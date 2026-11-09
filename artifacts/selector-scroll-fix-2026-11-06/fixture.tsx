import { useState } from "react";
import { createRoot } from "react-dom/client";
import { MaterialForm } from "/src/features/channels/MaterialForm";
import { blankInput } from "/src/features/channels/edit-buffer";
import { promoteRecordSchema, type PromoteInput } from "/src/types/cms";
import "/src/styles/globals.css";

// 本地内存演示：任何意外的 IPC 都拒绝执行，保存也不会调用 CMS。
Object.assign(window, {
  isTauri: true,
  __TAURI_INTERNALS__: {
    async invoke() {
      throw { code: "QA_WRITE_BLOCKED", message: "隔离验收：IPC 已阻断" };
    },
  },
});
const groups = Array.from({ length: 24 }, (_, index) => ({
  channel: `演示渠道 ${index + 1}`,
  subchannels: Array.from(
    { length: 24 },
    (_, child) =>
      `演示子渠道 ${child + 1}${child === 5 ? " · 长名称换行与搜索校验，文章推荐位置" : ""}`,
  ),
}));
const example = {
  ...blankInput(),
  channel: groups[2].channel,
  subChannel: groups[2].subchannels[5],
  title: "隔离演示 · 渠道选择器滚动回归",
  smallText: "仅使用内存中的演示素材，检查打开搜索菜单时表单位置是否保持稳定。",
  writer: "演示编辑",
  publishDate: "2026-11-06",
};
const base = promoteRecordSchema.parse({
  id: 1,
  ...example,
  articleId: null,
  host: null,
  landUrl: null,
  order: 1,
  createdAt: null,
  updatedAt: null,
  deletedAt: null,
});

function Harness() {
  const [mode, setMode] = useState<"new" | "edit" | "article" | null>(null);
  const [input, setInput] = useState<PromoteInput>(example);
  const [error, setError] = useState<string | null>(null);
  function open(next: "new" | "edit" | "article") {
    setInput(next === "new" ? blankInput() : example);
    setError(null);
    setMode(next);
  }
  return (
    <>
      <div className="border-b bg-muted px-4 py-2 text-xs">
        隔离验收 · 演示数据 · 真实共享素材表单 · 全部 IPC 与 CMS 写操作阻断
      </div>
      <main className="flex flex-col items-start gap-4 p-8">
        <h1>渠道选择器滚动修复</h1>
        <button id="open-new" onClick={() => open("new")}>
          新增演示素材
        </button>
        <button id="open-edit" onClick={() => open("edit")}>
          修改演示素材
        </button>
        <button id="open-article" onClick={() => open("article")}>
          文章转素材共享入口
        </button>
      </main>
      {mode && (
        <MaterialForm
          edit={{ base: mode === "edit" ? base : null, input }}
          title={mode === "article" ? "文章转渠道素材 · 隔离演示" : undefined}
          presentation={mode === "article" ? "dialog" : "channel-sheet"}
          onChange={setInput}
          onClose={() => setMode(null)}
          onSave={() => setError("隔离验收：保存被阻断，未修改线上素材")}
          busy={false}
          onUploading={() => {}}
          error={error}
          channels={{ groups, loading: false, error: null, retry() {} }}
        />
      )}
    </>
  );
}
createRoot(document.getElementById("root")!).render(<Harness />);
