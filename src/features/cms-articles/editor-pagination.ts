import { DOMSerializer, Fragment, type Node } from "@tiptap/pm/model";
import { cleanHtml } from "./editor-content";
import { isPageBreak as isMarker, readPageBreaks } from "./editor-page-break";

const characters = (text: string) => [...text.replace(/\s/gu, "")].length;
type Pagination = {
  breaks: { position: number; size: number; nested: boolean }[];
  pages: { from: number; to: number; characters: number }[];
};
const paginationCache = new WeakMap<Node, Pagination>();

export function readPagination(doc: Node) {
  // ProseMirror 文档不可变；选区频繁移动时复用分页索引，避免每次扫描全文。
  const cached = paginationCache.get(doc);
  if (cached) return cached;
  const breaks = readPageBreaks(doc);
  const starts = [0, ...breaks.map((item) => item.position + item.size)];
  const ends = [...breaks.map((item) => item.position), doc.content.size];
  const result = {
    breaks,
    pages: starts.map((from, index) => ({
      from,
      to: ends[index],
      characters: characters(doc.textBetween(from, ends[index], "")),
    })),
  };
  paginationCache.set(doc, result);
  return result;
}

function hasContent(content: Fragment) {
  let found = false;
  content.descendants((node) => {
    if (
      (node.isText && /\S/u.test(node.textContent)) ||
      ["image", "horizontalRule"].includes(node.type.name)
    )
      found = true;
    return !found;
  });
  return found;
}

export function insertionBoundary(doc: Node, selectionEnd: number) {
  const resolved = doc.resolve(selectionEnd);
  let position = resolved.depth ? resolved.after(1) : selectionEnd;
  // 图片后的连续图注属于同一内容组，手动分页也不能把它们拆开。
  let next = doc.nodeAt(position);
  while (next?.attrs.class === "img-caption" && !isMarker(next)) {
    position += next.nodeSize;
    next = doc.nodeAt(position);
  }
  const { breaks } = readPagination(doc);
  if (breaks.some((item) => item.nested)) return null;
  const preceding = breaks.filter((item) => item.position < position);
  const previous = preceding[preceding.length - 1];
  const following = breaks.find((item) => item.position >= position);
  // 只检查当前页两侧，拒绝文首、文末及已有分页旁的空页。
  if (
    !hasContent(
      doc.slice(previous ? previous.position + previous.size : 0, position)
        .content,
    ) ||
    !hasContent(
      doc.slice(position, following?.position ?? doc.content.size).content,
    )
  )
    return null;
  return position;
}

export function pagePreview(doc: Node, from: number, to: number) {
  const container = document.createElement("div");
  // 使用 schema 序列化切片，嵌套容器仍由有效标签包裹，预览不拼接 HTML 片段。
  container.append(
    DOMSerializer.fromSchema(doc.type.schema).serializeFragment(
      doc.slice(from, to).content,
    ),
  );
  return cleanHtml(container.innerHTML);
}
