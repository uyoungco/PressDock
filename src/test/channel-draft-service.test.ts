import { beforeEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { channelDraftService } from "@/features/channels/draft-service";
import { blankInput } from "@/features/channels/edit-buffer";
import { invalidateClientRequests } from "@/services/tauri/client";
import { deferred } from "./cms-fixtures";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: () => true,
}));
beforeEach(() => {
  vi.mocked(invoke).mockReset();
  invalidateClientRequests();
});
it("草稿串行写入使用输入快照，退出后丢弃旧账号排队写入", async () => {
  const first = deferred<null>();
  vi.mocked(invoke)
    .mockImplementationOnce(() => first.promise)
    .mockResolvedValue(null);
  const draft = {
    base: null,
    input: { ...blankInput(), title: "演示：原始快照" },
  };
  const saving = channelDraftService.save(6, draft);
  // 立即附上拒绝处理器，避免测试中的延迟拒绝被误报为未处理。
  const oldQueued = channelDraftService.save(6, draft).catch((error) => error);
  draft.input.title = "演示：后续输入";
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledTimes(1));
  expect(vi.mocked(invoke).mock.calls[0][1]).toMatchObject({
    expectedUser: 6,
    draft: { input: { title: "演示：原始快照" } },
  });
  const savingResult = saving.catch((error) => error);
  invalidateClientRequests();
  first.resolve(null);
  expect(await savingResult).toBeInstanceOf(Error);
  expect(await oldQueued).toBeInstanceOf(Error);
  expect(invoke).toHaveBeenCalledTimes(1);
  await channelDraftService.clear(7);
  expect(invoke).toHaveBeenLastCalledWith("channel_draft_clear", {
    expectedUser: 7,
  });
});
