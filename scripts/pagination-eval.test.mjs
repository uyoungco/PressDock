import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { baselinePlan, evaluate } from "./pagination-eval.mjs";

const fixtures = JSON.parse(
  await readFile(
    new URL("../docs/ai-pagination/demo-fixtures.json", import.meta.url),
    "utf8",
  ),
);

test("拒绝模型的未知、重复、逆序、文末编号和额外正文", () => {
  const fixture = fixtures.find((f) => f.id === "demo-caption-tail");
  for (const output of [
    { break_after: ["B999"] },
    { break_after: ["B1", "B1"] },
    { break_after: ["B3", "B1"] },
    { break_after: ["B5"] },
    { break_after: [], text: "模型改写的正文" },
  ])
    assert.equal(evaluate(fixture, output).valid, false);
});

test("图注拆分和短尾页必须报错", () => {
  const caption = fixtures.find((f) => f.id === "demo-caption-tail");
  assert.ok(
    evaluate(caption, { break_after: ["B2"] }).issues.includes(
      "bound_content:B2",
    ),
  );
  const quote = fixtures.find((f) => f.id === "demo-quote");
  assert.ok(
    evaluate(quote, { break_after: ["B4"] }).issues.includes("short_tail"),
  );
});

test("语义标注能修正纯字数初稿的问答、动作结果、解释和引语断裂", () => {
  for (const fixture of fixtures.filter((f) => f.split === "semantic")) {
    const before = evaluate(fixture, baselinePlan(fixture.blocks));
    assert.ok(before.issues.includes("bound_content:B2"));
    const after = evaluate(
      fixture,
      baselinePlan(fixture.blocks, {
        bind_after: ["B2"],
        prefer_after: ["B3"],
      }),
    );
    assert.deepEqual(after.issues, []);
  }
});

test("末块建议不会生成文末空页，超长不可拆单元保持完整", () => {
  const fixture = fixtures.find((f) => f.id === "demo-single-atom");
  const plan = baselinePlan(fixture.blocks, {
    bind_after: ["B1"],
    prefer_after: [],
  });
  assert.deepEqual(plan, { break_after: [] });
  assert.deepEqual(evaluate(fixture, plan).issues, []);
});
