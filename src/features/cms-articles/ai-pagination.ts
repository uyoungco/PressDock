import { Fragment, type Node } from "@tiptap/pm/model";
import {
  trackQuote,
  validatePaginationBoundaries,
} from "@/features/ai/pagination";
import type {
  PaginationBlock,
  PaginationOptions,
} from "@/features/ai/contracts";
import { pageBreak } from "./editor-content";
import { readPagination } from "./editor-pagination";

const count = (text: string) => [...text.replace(/\s/gu, "")].length;
type Piece = { node: Node; paragraph: number; from: number; to: number };
export type PreparedPagination = {
  doc: Node;
  blocks: PaginationBlock[];
  pieces: Piece[];
  hasText: boolean;
};

function sentences(text: string) {
  const ends: number[] = [],
    stack: string[] = [];
  let offset = 0,
    pending = false;
  const chars = [...text];
  chars.forEach((character, i) => {
    offset += character.length;
    const closing = trackQuote(stack, character);
    if (
      /[。！？!?]/u.test(character) ||
      (character === "." && (!chars[i + 1] || /\s/u.test(chars[i + 1])))
    )
      pending = true;
    else if (!closing && !/\s/u.test(character)) pending = false;
    if (
      pending &&
      !stack.length &&
      (!chars[i + 1] || !/[。！？!?”’」』）)"]/u.test(chars[i + 1]))
    ) {
      ends.push(offset);
      pending = false;
    }
  });
  if (ends[ends.length - 1] !== text.length) ends.push(text.length);
  return ends;
}

export function preparePagination(doc: Node): PreparedPagination {
  if (readPagination(doc).breaks.some((b) => b.nested))
    throw new Error("存在嵌套分页，请先在 HTML 源码中调整为顶层分页");
  const blocks: PaginationBlock[] = [],
    pieces: Piece[] = [];
  let lastImage: string | undefined;
  doc.forEach((node, _offset, paragraph) => {
    if (node.type.name === "paragraph" && node.textContent === pageBreak)
      return;
    let image = false,
      onlyText = true;
    node.descendants((child) => {
      if (child.type.name === "image") image = true;
      if (child.isLeaf && !child.isText) onlyText = false;
    });
    const caption = node.attrs.class === "img-caption";
    const text = node.textContent;
    const source =
      !image &&
      /^(?:来源\s*[:：]|(?:记者|编辑|责编|校对|审核|美编)\s*[:：])/u.test(
        text.trim(),
      );
    // 只拆纯文本顶层段落；列表、引用及含行内图片/硬换行的段落整体保留。
    const ends =
      node.type.name === "paragraph" && onlyText && !caption && !source
        ? sentences(text)
        : [node.content.size];
    let from = 0;
    for (const to of ends) {
      const id = `B${blocks.length + 1}`;
      const content = node.isTextblock ? node.cut(from, to).textContent : text;
      const type = caption
        ? "caption"
        : node.type.name === "heading"
          ? "heading"
          : source
            ? "source"
            : image && !content.trim()
              ? "image"
              : "text";
      blocks.push({
        id,
        type,
        paragraph,
        chars: count(content),
        ...(content ? { text: content } : {}),
        ...(caption && lastImage ? { caption_of: lastImage } : {}),
        ...(type === "heading" ? { keep_with_next: true } : {}),
      });
      pieces.push({ node, paragraph, from, to });
      if (image) lastImage = id;
      else if (!caption && content.trim()) lastImage = undefined;
      from = to;
    }
  });
  if (!blocks.length || !blocks.some((b) => b.chars || b.type === "image"))
    throw new Error("正文为空，无法生成分页");
  return { doc, blocks, pieces, hasText: blocks.some((b) => b.chars > 0) };
}

export function buildPagination(
  prepared: PreparedPagination,
  breakAfter: string[],
  options: PaginationOptions,
) {
  validatePaginationBoundaries(breakAfter, prepared.blocks);
  const boundaries = new Set(breakAfter);
  const nodes: Node[] = [];
  let pending: Piece | null = null;
  function flush() {
    if (!pending) return;
    const { node, from, to } = pending;
    nodes.push(
      from === 0 && to === node.content.size
        ? node
        : node.copy(node.content.cut(from, to)),
    );
    pending = null;
  }
  prepared.pieces.forEach((piece, i) => {
    if (pending?.paragraph === piece.paragraph)
      pending = { ...pending, to: piece.to };
    else {
      flush();
      pending = piece;
    }
    if (boundaries.has(prepared.blocks[i].id)) {
      flush();
      nodes.push(
        prepared.doc.type.schema.nodes.paragraph.create(
          null,
          prepared.doc.type.schema.text(pageBreak),
        ),
      );
    }
  });
  flush();
  const candidate = prepared.doc.copy(Fragment.from(nodes));
  candidate.check();
  return {
    candidate,
    oversized: readPagination(candidate).pages.some(
      (p) => p.characters > options.maxChars,
    ),
  };
}
