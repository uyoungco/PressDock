import { describe, expect, it } from "vitest";
import { type Node } from "@tiptap/pm/model";
import {
  parseCompatible,
  pageBreak,
} from "@/features/cms-articles/editor-content";
import { readPagination } from "@/features/cms-articles/editor-pagination";
import {
  preparePagination,
  buildPagination,
} from "@/features/cms-articles/ai-pagination";
import {
  validateSemanticPagination,
  validatePaginationBoundaries,
} from "@/features/ai/pagination";
import fixtures from "./fixtures/pagination-shared.json";

const parse = (html: string) => {
  const container = document.createElement("div");
  container.innerHTML = html;
  return parseCompatible(container);
};
function content(doc: Node) {
  const result: unknown[] = [];
  doc.forEach((node) => {
    if (node.textContent === pageBreak) return;
    node.descendants((child) => {
      if (child.isText)
        for (const c of child.text!)
          result.push([c, child.marks.map((m) => m.toJSON())]);
      else if (child.isLeaf) result.push(child.toJSON());
    });
  });
  return result;
}
describe("共用 Rust 分页计划的编辑器适配", () => {
  for (const fixture of fixtures)
    it(fixture.id + "：分块及内容格式与迁移前 V9 一致", () => {
      const prepared = preparePagination(parse(fixture.html));
      expect(prepared.blocks).toEqual(fixture.blocks);
      const { candidate, oversized } = buildPagination(
        prepared,
        fixture.breakAfter,
        fixture.options,
      );
      candidate.check();
      expect(content(candidate)).toEqual(content(prepared.doc));
      expect(readPagination(candidate).pages).toHaveLength(
        fixture.breakAfter.length + 1,
      );
      expect(candidate.lastChild?.textContent).not.toBe(pageBreak);
      if (!fixture.breakAfter.length && !fixture.html.includes(pageBreak))
        expect(candidate.eq(prepared.doc)).toBe(true);
      if (fixture.id === "quotes" || fixture.id === "brackets")
        expect(oversized).toBe(true);
      if (fixture.id === "rich")
        candidate.forEach((node) => {
          if (
            node.textContent !== pageBreak &&
            node.textContent !== "演".repeat(169) + "。"
          )
            expect(node.attrs.textAlign).toBe("center");
        });
      if (fixture.id === "images") expect(prepared.hasText).toBe(false);
      if (fixture.id === "tail")
        expect(
          readPagination(candidate).pages.every((p) => p.characters >= 100),
        ).toBe(true);
    });
  it("空文及嵌套分页拒绝；未知、乱序、重复、末块分页点拒绝", () => {
    expect(() => preparePagination(parse("<p></p>"))).toThrow("正文为空");
    expect(() =>
      preparePagination(
        parse("<blockquote><p>" + pageBreak + "</p></blockquote>"),
      ),
    ).toThrow("嵌套分页");
    const blocks = preparePagination(
      parse("<p>【演示数据】第一段。</p><p>第二段。</p><p>第三段。</p>"),
    ).blocks;
    for (const ids of [["B99"], ["B2", "B1"], ["B1", "B1"], ["B3"]])
      expect(() => validatePaginationBoundaries(ids, blocks)).toThrow();
    for (const value of [
      { bind_after: ["B99"], prefer_after: [] },
      { bind_after: ["B2", "B1"], prefer_after: [] },
      { bind_after: ["B1", "B1"], prefer_after: [] },
      { bind_after: ["B1"], prefer_after: ["B1"] },
      { bind_after: [], prefer_after: [], body: "改写" },
    ])
      expect(() => validateSemanticPagination(value, blocks)).toThrow();
  });
});
