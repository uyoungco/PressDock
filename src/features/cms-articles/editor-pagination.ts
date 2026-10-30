import { DOMSerializer, Fragment, type Node } from "@tiptap/pm/model";
import { pageBreak, cleanHtml } from "./editor-content";

const isMarker = (node: Node) =>
  node.type.name === "paragraph" && node.textContent === pageBreak;
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
  const breaks: Pagination["breaks"] = [];
  doc.descendants((node, position) => {
    if (isMarker(node)) {
      breaks.push({
        position,
        size: node.nodeSize,
        nested: doc.resolve(position).depth > 0,
      });
      return false;
    }
  });
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

export function automaticPagination(doc: Node) {
  if (readPagination(doc).breaks.some((item) => item.nested))
    throw new Error(
      "存在嵌套分页，请先在 HTML 源码中调整为顶层分页；本次未修改正文。",
    );
  const groups: { nodes: Node[]; length: number }[] = [];
  let leading: Node[] = [];
  doc.forEach((node) => {
    if (isMarker(node)) return;
    const length = characters(node.textContent);
    // 沿用采集端的装饰节点绑定方式，但保留所有节点及顺序，不清理或搬动正文。
    if (!length || node.attrs.class === "img-caption") {
      const previous = groups[groups.length - 1];
      if (previous) previous.nodes.push(node);
      else leading.push(node);
    } else {
      groups.push({ nodes: [...leading, node], length });
      leading = [];
    }
  });
  if (!groups.length) {
    // 纯图片正文保持单页，空正文则没有可生成的初稿。
    if (!hasContent(Fragment.fromArray(leading)))
      throw new Error("正文为空，暂无可分页内容。");
    return doc.type.create(doc.attrs, leading);
  }
  const lengths = [0];
  groups.forEach((group) =>
    lengths.push(lengths[lengths.length - 1] + group.length),
  );
  const end = groups.length;
  const boundaries = [0];
  let start = 0;
  // 与 Rust pages() 一致：240 字偏差优先，3～4 组优先，同分取更早边界。
  while (start < end) {
    if (lengths[end] - lengths[start] <= 280) {
      boundaries.push(end);
      break;
    }
    let best = start + 1;
    let score = Infinity;
    for (let next = start + 1; next <= end; next++) {
      const length = lengths[next] - lengths[start];
      const count = next - start;
      const current = (length - 240) ** 2 * 2 + Number(count < 3 || count > 4);
      if (current < score) {
        score = current;
        best = next;
      }
      if (length >= 280) break;
    }
    boundaries.push(best);
    start = best;
  }
  if (
    boundaries.length > 2 &&
    lengths[end] - lengths[boundaries[boundaries.length - 2]] < 100
  ) {
    start = boundaries[boundaries.length - 3];
    let best: number | null = null;
    let score = Infinity;
    for (let next = start + 1; next < end; next++) {
      const left = lengths[next] - lengths[start];
      const right = lengths[end] - lengths[next];
      if (right < 100) break;
      const leftCount = next - start;
      const rightCount = end - next;
      const current =
        ((left - 240) ** 2 + (right - 240) ** 2) * 3 +
        Number(leftCount < 3 || leftCount > 4) +
        Number(rightCount < 3 || rightCount > 4);
      if (current < score) {
        score = current;
        best = next;
      }
    }
    if (best === null) boundaries.splice(boundaries.length - 2, 1);
    else boundaries[boundaries.length - 2] = best;
  }
  const positions = new Set(boundaries.slice(1, -1));
  const nodes: Node[] = [];
  groups.forEach((group, index) => {
    if (positions.has(index))
      nodes.push(
        doc.type.schema.nodes.paragraph.create(
          null,
          doc.type.schema.text(pageBreak),
        ),
      );
    nodes.push(...group.nodes);
  });
  return doc.type.create(doc.attrs, nodes);
}
