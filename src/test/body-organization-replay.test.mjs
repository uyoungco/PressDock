import { readFileSync, writeFileSync } from "node:fs";
import { Editor } from "@tiptap/core";
import { expect, it } from "vitest";
import {
  editorExtensions,
  parseCompatible,
  prepareHtml,
} from "@/features/cms-articles/editor-content";

const dataset = process.env.PRESSDOCK_BODY_DATASET;
it.skipIf(!dataset)(
  "本机真实整理结果可经现有编辑器内容引擎往返，不增加正文或丢失图片",
  () => {
    const read = (name) =>
      JSON.parse(readFileSync(`${dataset}/${name}`, "utf8"));
    const fixtures = read("fixtures.json");
    const rows = [];
    const norm = (text) =>
      text
        .replaceAll("[!--empirenews.page--]", "")
        .replace(/\s|\u200b|\u2060|\ufeff/gu, "");
    for (const f of fixtures.filter((f) => !f.demo)) {
      const result = read(
        `${f.split === "holdout" ? "v6-holdout" : "v6"}/${f.id}-0.json`,
      );
      const html = result.rendered ?? f.html;
      const prepared = prepareHtml(html);
      // 不支持的原始格式保持只读保护，不能用丢弃属性换取可编辑。
      if (prepared.issue) {
        rows.push({ id: f.id, protected: true, reason: prepared.issue });
        continue;
      }
      const doc = parseCompatible(prepared.body);
      const element = document.createElement("div");
      document.body.append(element);
      const editor = new Editor({
        element,
        extensions: editorExtensions,
        content: doc.toJSON(),
        editable: false,
      });
      const expected = new DOMParser().parseFromString(html, "text/html");
      expect(norm(editor.getText())).toBe(
        norm(expected.body.textContent ?? ""),
      );
      const serialized = editor.getHTML();
      const roundtrip = new DOMParser().parseFromString(
        serialized,
        "text/html",
      );
      expect(roundtrip.querySelectorAll("img")).toHaveLength(
        expected.querySelectorAll("img").length,
      );
      rows.push({
        id: f.id,
        protected: false,
        textEqual: true,
        images: expected.querySelectorAll("img").length,
      });
      if (f.id === 11665072)
        writeFileSync(`${dataset}/editor-roundtrip.html`, serialized);
      editor.destroy();
      element.remove();
    }
    expect(rows).toHaveLength(20);
    writeFileSync(
      `${dataset}/editor-compatibility.json`,
      JSON.stringify(rows, null, 2),
    );
  },
);
