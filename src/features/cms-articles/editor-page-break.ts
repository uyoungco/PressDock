import { Extension } from "@tiptap/core";
import type { Node, ResolvedPos } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { Plugin, Selection, TextSelection } from "@tiptap/pm/state";
import type { EditorState } from "@tiptap/pm/state";
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view";
import { buttonVariants } from "@/components/ui/button";

export const pageBreak = "[!--empirenews.page--]";
export const isPageBreak = (node: Node | null | undefined) =>
  node?.type.name === "paragraph" && node.textContent === pageBreak;

type PageBreak = { position: number; size: number; nested: boolean };
const breakCache = new WeakMap<Node, PageBreak[]>();

export function readPageBreaks(doc: Node) {
  const cached = breakCache.get(doc);
  if (cached) return cached;
  const breaks: PageBreak[] = [];
  doc.descendants((node, position) => {
    if (!isPageBreak(node)) return;
    breaks.push({
      position,
      size: node.nodeSize,
      nested: doc.resolve(position).depth > 0,
    });
    return false;
  });
  breakCache.set(doc, breaks);
  return breaks;
}

// 跳过连续分页，避免删除后把光标放进另一个隐藏的机器标记。
function contentSelection(doc: Node, position: number, direction: number) {
  for (const bias of [direction, -direction]) {
    let current = position;
    while (current >= 0 && current <= doc.content.size) {
      const selection = Selection.findFrom(doc.resolve(current), bias, true);
      if (!selection) break;
      if (!isPageBreak(selection.$from.parent)) return selection;
      current = bias > 0 ? selection.$from.after() : selection.$from.before();
    }
  }
  return Selection.near(doc.resolve(position));
}

function commitDeletion(
  view: EditorView,
  from: number,
  to: number,
  focus: boolean,
  preserveCursor: boolean,
  direction = 1,
) {
  if (!view.editable || readPageBreaks(view.state.doc).some((b) => b.nested))
    return false;
  const transaction = closeHistory(view.state.tr).delete(from, to);
  if (
    !preserveCursor ||
    !transaction.selection.empty ||
    isPageBreak(transaction.selection.$from.parent)
  ) {
    transaction.setSelection(
      contentSelection(transaction.doc, from, direction),
    );
  }
  view.dispatch(focus ? transaction.scrollIntoView() : transaction);
  view.dispatch(closeHistory(view.state.tr).setMeta("addToHistory", false));
  if (focus) view.focus();
  return true;
}

export function deletePageBreakAt(
  view: EditorView,
  position: number,
  focus = true,
) {
  const item = readPageBreaks(view.state.doc).find(
    (b) => b.position === position,
  );
  return item
    ? commitDeletion(view, position, position + item.size, focus, false)
    : false;
}

function adjacentCut($cursor: ResolvedPos, direction: number) {
  if (!$cursor.depth) return $cursor;
  if ($cursor.parent.type.spec.isolating) return null;
  for (let depth = $cursor.depth - 1; depth >= 0; depth--) {
    const hasSibling =
      direction < 0
        ? $cursor.index(depth) > 0
        : $cursor.indexAfter(depth) < $cursor.node(depth).childCount;
    if (hasSibling)
      return $cursor.doc.resolve(
        direction < 0 ? $cursor.before(depth + 1) : $cursor.after(depth + 1),
      );
    if ($cursor.node(depth).type.spec.isolating) break;
  }
  return null;
}

function deletionRange(state: EditorState, direction: number) {
  const { selection, doc } = state;
  const breaks = readPageBreaks(doc);
  if (!selection.empty) {
    const touched = breaks.filter(
      (b) => selection.from < b.position + b.size && selection.to > b.position,
    );
    if (!touched.length) return null;
    return {
      from: Math.min(selection.from, touched[0].position),
      to: Math.max(
        selection.to,
        touched[touched.length - 1].position + touched[touched.length - 1].size,
      ),
    };
  }
  const { $from } = selection;
  if (isPageBreak($from.parent))
    return { from: $from.before(), to: $from.after() };
  if (!(selection instanceof TextSelection) && $from.depth) return null;
  if (
    $from.depth &&
    $from.parentOffset !== (direction < 0 ? 0 : $from.parent.content.size)
  )
    return null;
  const cut = adjacentCut($from, direction);
  const node = direction < 0 ? cut?.nodeBefore : cut?.nodeAfter;
  if (!cut || !isPageBreak(node)) return null;
  const from = direction < 0 ? cut.pos - node!.nodeSize : cut.pos;
  return { from, to: from + node!.nodeSize };
}

export const CmsPagination = Extension.create({
  name: "cmsPaginationDisplay",
  // 在 StarterKit 的段落合并前消费分页删除，避免隐藏标记被并入正文。
  priority: 1000,
  addKeyboardShortcuts() {
    const remove = (direction: number) => {
      const range = deletionRange(this.editor.state, direction);
      if (!range) return false;
      commitDeletion(
        this.editor.view,
        range.from,
        range.to,
        true,
        this.editor.state.selection.empty,
        direction,
      );
      // 只读或嵌套保护时同样拦截，禁止默认合并操作破坏分页标记。
      return true;
    };
    return { Backspace: () => remove(-1), Delete: () => remove(1) };
  },
  addProseMirrorPlugins() {
    const decorate = (doc: Node) => {
      const decorations: Decoration[] = [];
      readPageBreaks(doc).forEach((item, index) => {
        const { position, size } = item;
        const page = index + 1;
        decorations.push(
          Decoration.node(position, position + size, {
            class: "cms-page-break",
            contenteditable: "false",
            role: "group",
            "aria-label": `第 ${page} 页与第 ${page + 1} 页之间的分页点`,
            "data-page-label": `第 ${page} 页 / 第 ${page + 1} 页`,
          }),
          Decoration.inline(position + 1, position + size - 1, {
            class: "cms-page-break-source",
          }),
          Decoration.widget(
            position + 1,
            (view, getPos) => {
              const button = document.createElement("button");
              button.type = "button";
              button.className = buttonVariants({
                variant: "destructive",
                size: "xs",
                className: "cms-page-break-delete",
              });
              button.dataset.cmsDeletePageBreak = "";
              button.textContent = "删除分页";
              button.setAttribute("aria-label", `删除第 ${page} 页后的分页`);
              button.disabled =
                !view.editable ||
                readPageBreaks(view.state.doc).some((b) => b.nested);
              button.addEventListener("mousedown", (event) =>
                event.preventDefault(),
              );
              button.addEventListener("click", () => {
                const current = getPos();
                if (current !== undefined) deletePageBreakAt(view, current - 1);
              });
              return button;
            },
            {
              key: `cms-page-break-delete-${page}`,
              side: -1,
              stopEvent: () => true,
              ignoreSelection: true,
            },
          ),
        );
      });
      return DecorationSet.create(doc, decorations);
    };
    const syncButtons = (view: EditorView) => {
      const disabled =
        !view.editable || readPageBreaks(view.state.doc).some((b) => b.nested);
      view.dom
        .querySelectorAll<HTMLButtonElement>("[data-cms-delete-page-break]")
        .forEach((button) => {
          button.disabled = disabled;
        });
    };
    return [
      new Plugin<DecorationSet>({
        state: {
          init: (_, state) => decorate(state.doc),
          apply: (transaction, value) =>
            transaction.docChanged ? decorate(transaction.doc) : value,
        },
        props: {
          decorations(state) {
            return this.getState(state);
          },
        },
        view(view) {
          syncButtons(view);
          return { update: syncButtons };
        },
      }),
    ];
  },
});
