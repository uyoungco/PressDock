import {
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import type { Editor, EditorEvents } from "@tiptap/core";
import type { Node as EditorNode } from "@tiptap/pm/model";
import { SeparatorHorizontalIcon } from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuGroup,
  ContextMenuItem,
  ContextMenuShortcut,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { insertionBoundary } from "./editor-pagination";

function clickedBoundary(editor: Editor, event: MouseEvent) {
  const { view } = editor;
  if (!(event.target instanceof Node) || !view.dom.contains(event.target))
    return null;
  try {
    let block = event.target;
    if (block !== view.dom) {
      while (block.parentNode !== view.dom) block = block.parentNode!;
      // 映射顶层块后的 DOM 边界，兼容行内图片、嵌套列表和分隔线等叶节点。
      const offset = Array.from<Node>(view.dom.childNodes).indexOf(block) + 1;
      return insertionBoundary(
        editor.state.doc,
        view.posAtDOM(view.dom, offset),
      );
    }
    // 正文内边距等空白处以实际命中位置为准，不回退到旧光标。
    const hit = view.posAtCoords({ left: event.clientX, top: event.clientY });
    return hit ? insertionBoundary(editor.state.doc, hit.pos) : null;
  } catch {
    return null;
  }
}

export function EditorPageMenu({
  editor,
  disabled,
  onInsert,
  shortcutLabel,
  shortcutKeys,
  children,
}: {
  editor: Editor;
  disabled: boolean;
  onInsert: (position: number) => void;
  shortcutLabel: string;
  shortcutKeys: string;
  children: ReactNode;
}) {
  const [target, setTarget] = useState<{
    doc: EditorNode;
    position: number | null;
  } | null>(null);
  const restoreFocus = useRef(false);

  useEffect(() => {
    const closeOnChange = ({ transaction }: EditorEvents["transaction"]) => {
      if (transaction.docChanged) setTarget(null);
    };
    editor.on("transaction", closeOnChange);
    return () => {
      editor.off("transaction", closeOnChange);
    };
  }, [editor]);
  useEffect(() => {
    if (disabled) {
      restoreFocus.current = false;
      setTarget(null);
    }
  }, [disabled]);

  return (
    <ContextMenu
      modal={false}
      open={!!target && !disabled && target.doc === editor.state.doc}
      onOpenChange={(open) => {
        if (!open) setTarget(null);
      }}
    >
      <ContextMenuTrigger
        asChild
        className="select-text"
        data-pressdock-context-menu={disabled ? undefined : "article-body"}
        disabled={disabled}
        onContextMenu={(event) => {
          if (disabled || editor.isDestroyed) return;
          restoreFocus.current = false;
          setTarget({
            doc: editor.state.doc,
            position: clickedBoundary(editor, event),
          });
        }}
      >
        <div>{children}</div>
      </ContextMenuTrigger>
      <ContextMenuContent
        aria-label="正文右键菜单"
        onEscapeKeyDown={() => {
          restoreFocus.current = true;
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          if (
            restoreFocus.current &&
            !disabled &&
            !editor.isDestroyed &&
            editor.isEditable
          )
            editor.view.focus();
          restoreFocus.current = false;
        }}
      >
        <ContextMenuGroup>
          <ContextMenuItem
            aria-label="插入分页符"
            aria-keyshortcuts={shortcutKeys}
            disabled={disabled || target?.position == null}
            onSelect={() => {
              if (
                disabled ||
                editor.isDestroyed ||
                target?.doc !== editor.state.doc ||
                target.position === null
              )
                return;
              restoreFocus.current = true;
              onInsert(target.position);
            }}
          >
            <SeparatorHorizontalIcon />
            插入分页符
            <ContextMenuShortcut>{shortcutLabel}</ContextMenuShortcut>
          </ContextMenuItem>
        </ContextMenuGroup>
      </ContextMenuContent>
    </ContextMenu>
  );
}
