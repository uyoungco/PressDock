import { useEffect, useRef, useState, type ReactNode } from "react";
import { selectionToInsertionEnd } from "@tiptap/core";
import {
  EditorContent,
  useEditor,
  useEditorState,
  type Editor,
} from "@tiptap/react";
import { DOMParser as SchemaParser, Fragment, Slice } from "@tiptap/pm/model";
import { closeHistory } from "@tiptap/pm/history";
import { TextSelection, type SelectionBookmark } from "@tiptap/pm/state";
import {
  AlignCenterIcon,
  AlignLeftIcon,
  BoldIcon,
  ChevronDownIcon,
  CodeXmlIcon,
  EraserIcon,
  ImagePlusIcon,
  InfoIcon,
  ItalicIcon,
  LinkIcon,
  ListIcon,
  ListOrderedIcon,
  RedoIcon,
  SeparatorHorizontalIcon,
  UnderlineIcon,
  UndoIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Separator } from "@/components/ui/separator";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { onClientInvalidated, ServiceError } from "@/services/tauri/client";
import { articleService } from "./service";
import {
  cleanHtml,
  editorExtensions,
  pageBreak,
  parseCompatible,
  prepareHtml,
  previewHtml,
} from "./editor-content";

const imageTypes = ["image/jpeg", "image/png", "image/webp"];
const imageSizeLimit = 20 * 1024 * 1024;

function ToolHint({ label, children }: { label: string; children: ReactNode }) {
  return (
    <Tooltip>
      {/* 提示状态放在包装层，避免覆盖 ToggleGroupItem 的选中 data-state。 */}
      <TooltipTrigger asChild>
        <span className="inline-flex">{children}</span>
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}

export default function RichTextEditor({
  initialHtml,
  disabled,
  onChange,
  onUploading,
  onError,
}: {
  initialHtml: string;
  disabled: boolean;
  onChange: (html: string) => void;
  onUploading: (value: boolean) => void;
  onError: (message: string) => void;
}) {
  // 只在当前文章挂载时解析；父表单回传 newsText 不能覆盖选区或清空撤销历史。
  const [initial] = useState(() => {
    const prepared = prepareHtml(initialHtml);
    try {
      if (prepared.issue) throw new Error(prepared.issue);
      return {
        original: initialHtml,
        doc: parseCompatible(prepared.body),
        issue: "",
      };
    } catch (error) {
      return {
        original: initialHtml,
        doc: null,
        issue: error instanceof Error ? error.message : "正文格式暂不支持",
      };
    }
  });
  const [compatibility, setCompatibility] = useState(initial.issue);
  const [uploading, setUploadingState] = useState(false);
  const [validSession, setValidSession] = useState(true);
  const [link, setLink] = useState<{
    href: string;
    text: string;
    hasSelection: boolean;
    hasLink: boolean;
    bookmark: SelectionBookmark;
  } | null>(null);
  const [linkError, setLinkError] = useState("");
  const [source, setSource] = useState<{
    html: string;
    bookmark: SelectionBookmark;
  } | null>(null);
  const [sourceError, setSourceError] = useState("");
  const fileInput = useRef<HTMLInputElement>(null);
  const toolbar = useRef<HTMLDivElement>(null);
  const fileSelection = useRef<SelectionBookmark | null>(null);
  const baseline = useRef(initial.doc);
  const work = useRef({
    editor: null as Editor | null,
    active: false,
    valid: true,
    uploading: false,
  });
  const latest = useRef({
    disabled,
    onChange,
    onUploading,
    onError,
    compatibility,
  });
  latest.current = { disabled, onChange, onUploading, onError, compatibility };

  const editor: Editor | null = useEditor({
    extensions: editorExtensions,
    content: initial.doc?.toJSON() ?? "<p></p>",
    immediatelyRender: false,
    shouldRerenderOnTransaction: false,
    injectCSS: false,
    enableContentCheck: true,
    // 粘贴只保留原有格式，禁用会把分页标记中的域名或 Markdown 自动改写的规则。
    enablePasteRules: false,
    editable: !disabled && !initial.issue,
    editorProps: {
      attributes: {
        class: "cms-editor-body",
        role: "textbox",
        "aria-label": "文章正文",
        "aria-multiline": "true",
      },
      handlePaste(_view, event) {
        const current = work.current;
        if (!canEdit()) {
          event.preventDefault();
          return true;
        }
        const data = event.clipboardData;
        if (!data) return false;
        const html = data.getData("text/html");
        // items 与 files 是同一图片的两种表示，优先 items、回退 files，不重复追加。
        const itemFiles = Array.from(data.items)
          .filter(
            (item) => item.kind === "file" && item.type.startsWith("image/"),
          )
          .map((item) => item.getAsFile())
          .filter((file) => file !== null);
        const files = itemFiles.length
          ? itemFiles
          : Array.from(data.files).filter((file) =>
              file.type.startsWith("image/"),
            );
        if (!html && !files.length) return false;
        // 异步上传前同步拦截，临时图片地址始终只存在于脱离编辑器的 DOM 中。
        event.preventDefault();
        void pasteImages(
          current,
          current.editor!.state.selection.getBookmark(),
          html,
          data.getData("text/plain"),
          files,
        );
        return true;
      },
    },
    onUpdate({ editor, transaction }) {
      if (
        !transaction.docChanged ||
        work.current.editor !== editor ||
        !isCurrent(work.current) ||
        latest.current.compatibility
      )
        return;
      // 只有真实正文变更才通知表单；撤销到初始文档时恢复原始 HTML 字节。
      latest.current.onChange(
        baseline.current?.eq(editor.state.doc)
          ? initial.original
          : cleanHtml(editor.getHTML()),
      );
    },
    onContentError({ editor }) {
      editor.setEditable(false, false);
      setCompatibility("正文结构无法完整保留，已保护原文");
    },
  });

  useEffect(() => {
    if (!editor) return;
    // 校验 schema 与运行时 schema 是不同实例，快照须转换到当前 schema 才能用 eq 比较。
    baseline.current = initial.doc
      ? editor.schema.nodeFromJSON(initial.doc.toJSON())
      : null;
    const current = { editor, active: true, valid: true, uploading: false };
    work.current = current;
    // 懒初始化后同步工具栏订阅；空事务不会修改正文、选区或撤销历史。
    editor.view.dispatch(editor.state.tr.setMeta("addToHistory", false));
    const unsubscribe = onClientInvalidated(() => {
      current.valid = false;
      current.uploading = false;
      editor.setEditable(false, false);
      setValidSession(false);
      setUploadingState(false);
      setLink(null);
      setSource(null);
      setSourceError("");
      latest.current.onUploading(false);
    });
    return () => {
      current.active = false;
      unsubscribe();
    };
  }, [editor, initial.doc]);
  useEffect(() => {
    editor?.setEditable(
      !disabled && !uploading && validSession && !compatibility,
      false,
    );
  }, [editor, disabled, uploading, validSession, compatibility]);
  useEffect(() => {
    if (!editor) return;
    // 吸顶栏换行后高度会变化，滚动选区时按实际高度留白，避免光标被工具栏遮挡。
    const updateMargin = () =>
      editor.view.setProps({
        scrollMargin: {
          top: toolbar.current!.offsetHeight + 8,
          bottom: 8,
          left: 8,
          right: 8,
        },
      });
    updateMargin();
    const observer = new ResizeObserver(updateMargin);
    observer.observe(toolbar.current!);
    return () => observer.disconnect();
  }, [editor]);

  function isCurrent(current: typeof work.current) {
    return (
      current.active &&
      current.valid &&
      !current.editor!.isDestroyed &&
      work.current === current
    );
  }
  function canEdit() {
    return (
      isCurrent(work.current) &&
      !work.current.uploading &&
      !latest.current.disabled &&
      !latest.current.compatibility
    );
  }
  function setUploading(current: typeof work.current, value: boolean) {
    current.uploading = value;
    current.editor!.setEditable(
      !value &&
        !latest.current.disabled &&
        !latest.current.compatibility &&
        current.valid,
      false,
    );
    setUploadingState(value);
    latest.current.onUploading(value);
  }
  function restoreSelection(bookmark: SelectionBookmark) {
    if (!canEdit()) return;
    editor!.view.dispatch(
      editor!.state.tr.setSelection(bookmark.resolve(editor!.state.doc)),
    );
  }

  async function pasteImages(
    current: typeof work.current,
    bookmark: SelectionBookmark,
    html: string,
    text: string,
    files: File[],
  ) {
    const target = current.editor!;
    try {
      const raw = new DOMParser().parseFromString(html, "text/html");
      if (!html && text)
        text.split(/\r\n|\r|\n/).forEach((line) => {
          const paragraph = raw.createElement("p");
          paragraph.textContent = line;
          raw.body.append(paragraph);
        });
      const imageOnly =
        raw.images.length === 1 && !raw.body.textContent?.trim();
      if (imageOnly) {
        // 浏览器复制单图会附带继承的网页外观样式；只保留图片尺寸和块对齐，避免误拦上传。
        // 仅处理本次单图粘贴，图文混排与历史正文仍走完整的兼容校验。
        for (const element of raw.body.querySelectorAll<HTMLElement>(
          "[style]",
        )) {
          for (const property of Array.from(element.style)) {
            const keep =
              (element.tagName === "IMG" &&
                ["width", "height", "max-width", "max-height"].includes(
                  property,
                )) ||
              (/^P$|^H[1-6]$/.test(element.tagName) &&
                property === "text-align" &&
                ["left", "center", "right", "justify"].includes(
                  element.style.getPropertyValue(property),
                ));
            if (!keep) element.style.removeProperty(property);
          }
          if (!element.style.length) element.removeAttribute("style");
        }
      }
      // 网页右键复制单图时，即使 src 为远程地址，也以剪贴板文件上传并原位回填。
      const singleFile = imageOnly && files.length === 1;
      Array.from(raw.images).forEach((image) => {
        if (
          singleFile ||
          !image.getAttribute("src") ||
          /^(data:|blob:|file:)/i.test(image.getAttribute("src")!)
        )
          image.removeAttribute("srcset");
      });
      const prepared = prepareHtml(raw.documentElement.outerHTML);
      if (prepared.issue)
        throw new Error(
          `未插入内容：${prepared.issue}。可改用纯文本粘贴或单独补贴图片。`,
        );
      const uploads: { image: HTMLImageElement; file?: File; label: string }[] =
        [];
      const images = Array.from(prepared.body.querySelectorAll("img"));
      if (singleFile)
        uploads.push({
          image: images[0],
          file: files[0],
          label: files[0].name || "第 1 张图片",
        });
      else if (images.length) {
        // 图文混排以 HTML 结构为准，只转存内嵌图片，保留远程地址且忽略文件副本。
        images.forEach((image, index) => {
          if (
            !image.getAttribute("src") ||
            /^(data:|blob:|file:)/i.test(image.getAttribute("src")!)
          ) {
            image.removeAttribute("srcset");
            uploads.push({ image, label: `第 ${index + 1} 张图片` });
          }
        });
      } else {
        if (!html && !text && files.length) prepared.body.replaceChildren();
        files.forEach((file, index) => {
          const paragraph = prepared.body.ownerDocument.createElement("p");
          const image = prepared.body.ownerDocument.createElement("img");
          paragraph.append(image);
          prepared.body.append(paragraph);
          uploads.push({
            image,
            file,
            label: file.name || `第 ${index + 1} 张图片`,
          });
        });
      }
      // 上传之前验证整段结构；仅在校验副本中替换临时地址，不发起无效内容的上传。
      const audit = prepared.body.cloneNode(true) as HTMLElement;
      const auditImages = audit.querySelectorAll("img");
      const pending = new Set(uploads.map((item) => item.image));
      Array.from(prepared.body.querySelectorAll("img")).forEach(
        (image, index) => {
          if (pending.has(image))
            auditImages[index].setAttribute(
              "src",
              `https://pressdock.invalid/pending-${index}.png`,
            );
        },
      );
      parseCompatible(audit);
      const errors: string[] = [];
      // 整批持有一次上传锁，单图失败继续处理，不在两次请求之间开放保存或编辑。
      if (uploads.length) setUploading(current, true);
      for (const [index, item] of uploads.entries()) {
        if (!isCurrent(current)) return;
        try {
          let file = item.file;
          if (!file) {
            const data =
              /^data:(image\/(?:jpeg|png|webp));base64,([\s\S]*)$/i.exec(
                item.image.getAttribute("src") ?? "",
              );
            if (!data)
              throw new Error(
                "请粘贴 JPG、PNG、WebP 图片文件或有效的 Base64 图片",
              );
            const encoded = data[2].replace(/\s/g, "");
            if (encoded.length > 4 * Math.ceil(imageSizeLimit / 3))
              throw new Error("请选择不超过 20 MiB 的图片");
            let binary: string;
            try {
              binary = atob(encoded);
            } catch {
              throw new Error("图片数据无效");
            }
            const type = data[1].toLowerCase();
            file = new File(
              [Uint8Array.from(binary, (character) => character.charCodeAt(0))],
              `pasted-image-${index + 1}.${type.split("/")[1]}`,
              { type },
            );
          }
          if (!imageTypes.includes(file.type))
            throw new Error("仅支持 JPG、PNG、WebP 图片");
          const result = await articleService.upload(file);
          if (!isCurrent(current)) return;
          item.image.setAttribute("src", result.url);
        } catch (error) {
          if (!isCurrent(current)) return;
          if (
            error instanceof ServiceError &&
            ["SESSION_CHANGED", "AUTH_EXPIRED"].includes(error.code)
          )
            throw error;
          item.image.remove();
          errors.push(
            `${item.label}：${error instanceof Error ? error.message : "图片上传失败"}`,
          );
        }
      }
      if (!isCurrent(current)) return;
      const selection = bookmark.resolve(target.state.doc);
      if (
        !uploads.length ||
        prepared.body.textContent?.trim() ||
        prepared.body.querySelector("img,hr")
      ) {
        parseCompatible(prepared.body);
        const parsed = SchemaParser.fromSchema(target.schema).parseSlice(
          prepared.body,
          { preserveWhitespace: "full" },
        );
        // 有块语义的首尾必须封闭，防止合并到原段落时丢掉标题、图注、对齐或分页。
        const isolatedBlock = (node: typeof parsed.content.firstChild) =>
          node &&
          (node.type.name !== "paragraph" ||
            node.attrs.class ||
            node.attrs.textAlign ||
            node.textContent === pageBreak);
        const slice = new Slice(
          parsed.content,
          isolatedBlock(parsed.content.firstChild) ? 0 : parsed.openStart,
          isolatedBlock(parsed.content.lastChild) ? 0 : parsed.openEnd,
        );
        // 恢复原选区后用单事务替换，前后隔离历史；重做只恢复节点，不重新上传。
        target.view.dispatch(
          closeHistory(target.state.tr)
            .setSelection(selection)
            .replaceSelection(slice)
            .setMeta("paste", true)
            .setMeta("uiEvent", "paste")
            .scrollIntoView(),
        );
        target.view.dispatch(
          closeHistory(target.state.tr).setMeta("addToHistory", false),
        );
      } else {
        target.view.dispatch(target.state.tr.setSelection(selection));
      }
      target.view.focus();
      // Tiptap 的 onUpdate 在事务派发时同步执行，失败提示放在正文回调之后。
      if (errors.length)
        latest.current.onError(
          `以下图片未插入，请单独补贴。${errors.join("；")}`,
        );
    } catch (error) {
      if (isCurrent(current)) {
        target.view.dispatch(
          target.state.tr.setSelection(bookmark.resolve(target.state.doc)),
        );
        latest.current.onError(
          error instanceof Error ? error.message : "粘贴图片失败",
        );
      }
    } finally {
      if (isCurrent(current) && current.uploading) setUploading(current, false);
    }
  }

  const state = useEditorState({
    editor,
    selector: ({ editor }) => ({
      marks: ["bold", "italic", "underline"].filter((name) =>
        editor?.isActive(name),
      ),
      list: editor?.isActive("bulletList")
        ? "bulletList"
        : editor?.isActive("orderedList")
          ? "orderedList"
          : "",
      align:
        editor?.getAttributes("paragraph").textAlign ??
        editor?.getAttributes("heading").textAlign ??
        "left",
      heading: editor?.isActive("heading")
        ? String(editor.getAttributes("heading").level)
        : "0",
      undo: editor?.can().undo() ?? false,
      redo: editor?.can().redo() ?? false,
    }),
  });
  const locked =
    !editor || disabled || uploading || !validSession || !!compatibility;
  // 保护模式允许查看原始源码；上传、保存和失效会话仍禁止打开弹窗。
  const sourceLocked = !editor || disabled || uploading || !validSession;
  function openSource() {
    if (
      !isCurrent(work.current) ||
      work.current.uploading ||
      latest.current.disabled
    )
      return;
    setSourceError("");
    setSource({
      // 父表单回传的 initialHtml 就是待保存 newsText，不能直接序列化并重排原文。
      html: initialHtml,
      bookmark: editor!.state.selection.getBookmark(),
    });
  }
  function closeSource() {
    if (source) restoreSelection(source.bookmark);
    setSource(null);
  }
  function applySource() {
    if (!source || !canEdit()) return;
    if (source.html === initialHtml) {
      closeSource();
      return;
    }
    try {
      // 先检查原始图片地址，避免净化后临时地址消失，或绕过正文的上传流程。
      const raw = new DOMParser().parseFromString(source.html, "text/html");
      if (
        Array.from(raw.images).some((image) =>
          /^(data|blob|file|filesystem):/i.test(
            (image.getAttribute("src") ?? "").trim(),
          ),
        )
      )
        throw new Error(
          "请通过正文粘贴或工具栏上传图片，源码不支持临时图片地址",
        );
      const prepared = prepareHtml(source.html);
      if (prepared.issue) throw new Error(prepared.issue);
      const target = editor!;
      const document = target.schema.nodeFromJSON(
        parseCompatible(prepared.body).toJSON(),
      );
      if (document.eq(target.state.doc)) {
        // 等价 HTML 不创建历史记录，也不把原始正文换成规范化后的字符串。
        closeSource();
        return;
      }
      // 全文更新只用一个事务，前后隔离历史，使撤销/重做以一次源码应用为单位。
      const transaction = closeHistory(target.state.tr).replaceWith(
        0,
        target.state.doc.content.size,
        document.content,
      );
      transaction.setSelection(TextSelection.atStart(transaction.doc));
      target.view.dispatch(transaction.scrollIntoView());
      target.view.dispatch(
        closeHistory(target.state.tr).setMeta("addToHistory", false),
      );
      // 应用后保留新文档开头的光标，取消时才恢复弹窗打开前的书签。
      setSource(null);
    } catch (error) {
      setSourceError(
        error instanceof Error ? error.message : "HTML 源码无法应用",
      );
    }
  }
  function insertPageBreak() {
    if (!canEdit()) return;
    const target = editor!;
    const paragraph = target.schema.nodes.paragraph;
    const marker = paragraph.create(null, target.schema.text(pageBreak));
    // 直接在选区末尾的零宽范围插入，避免邻近选区落到分隔线等节点上并替换原内容。
    const end = target.state.selection.to;
    const transaction = closeHistory(target.state.tr).replaceRange(
      end,
      end,
      new Slice(Fragment.from(marker), 0, 0),
    );
    // 块拟合可能把插入点移到段落外，使用实际插入终点定位后续输入位置。
    selectionToInsertionEnd(transaction, 0, 1);
    const { $from } = transaction.selection;
    if (
      $from.parent.type === paragraph &&
      $from.parent.textContent === pageBreak
    ) {
      // 文末或紧邻其他分页时补普通空段落，让后续输入不会改写分页标记。
      const position = $from.parentOffset ? $from.after() : $from.before();
      transaction.insert(position, paragraph.create());
      transaction.setSelection(
        TextSelection.create(transaction.doc, position + 1),
      );
    }
    target.view.dispatch(transaction.scrollIntoView());
    target.view.dispatch(
      closeHistory(target.state.tr).setMeta("addToHistory", false),
    );
    target.view.focus();
  }
  function openLink() {
    if (!canEdit()) return;
    if (editor!.isActive("link")) editor!.commands.extendMarkRange("link");
    const { from, to, empty } = editor!.state.selection;
    setLinkError("");
    setLink({
      href: String(editor!.getAttributes("link").href ?? ""),
      text: editor!.state.doc.textBetween(from, to),
      hasSelection: !empty,
      hasLink: editor!.isActive("link"),
      bookmark: editor!.state.selection.getBookmark(),
    });
  }
  function saveLink() {
    if (!link || !canEdit()) return;
    const href = link.href.trim();
    const check = new DOMParser().parseFromString(
      cleanHtml(
        `<a href="${href.replace(/&/g, "&amp;").replace(/"/g, "&quot;")}">链接</a>`,
      ),
      "text/html",
    );
    if (!href || check.querySelector("a")?.getAttribute("href") !== href) {
      setLinkError("请输入有效的链接地址");
      return;
    }
    restoreSelection(link.bookmark);
    if (link.hasSelection) {
      if (!editor!.chain().setLink({ href }).run()) {
        setLinkError("链接地址不受支持");
        return;
      }
    } else {
      editor!.commands.insertContent({
        type: "text",
        text: link.text || href,
        marks: [
          ...(
            editor!.state.storedMarks ?? editor!.state.selection.$from.marks()
          )
            .filter((mark) => mark.type.name !== "link")
            .map((mark) => mark.toJSON()),
          { type: "link", attrs: { href } },
        ],
      });
    }
    setLink(null);
  }
  function action(
    label: string,
    icon: ReactNode,
    run: () => void,
    unavailable = false,
  ) {
    return (
      <ToolHint label={label}>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={label}
          disabled={locked || unavailable}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (canEdit()) run();
          }}
        >
          {icon}
        </Button>
      </ToolHint>
    );
  }
  return (
    // 外层不创建额外滚动容器；sticky 的负偏移补偿表单 p-4，吸顶后紧贴抽屉标题。
    <div className="cms-rich-editor min-w-0 rounded-md border">
      <div
        ref={toolbar}
        role="toolbar"
        aria-label="正文工具栏"
        className="sticky -top-4 z-20 flex flex-wrap items-center gap-1 rounded-t-md border-b bg-popover p-1"
      >
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={locked}
              aria-label="正文样式"
              onMouseDown={(event) => event.preventDefault()}
            >
              {state?.heading === "0" ? "正文" : `H${state?.heading}`}
              <ChevronDownIcon data-icon="inline-end" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuGroup>
              <DropdownMenuRadioGroup
                value={state?.heading ?? "0"}
                onValueChange={(value) => {
                  if (!canEdit()) return;
                  const chain = editor!.chain().focus();
                  if (value === "0") chain.setParagraph().run();
                  else
                    chain
                      .toggleHeading({
                        level: Number(value) as 1 | 2 | 3 | 4 | 5,
                      })
                      .run();
                }}
              >
                {[0, 1, 2, 3, 4, 5].map((level) => (
                  <DropdownMenuRadioItem key={level} value={String(level)}>
                    {level ? `标题 ${level}` : "正文"}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <ToggleGroup
          type="multiple"
          size="sm"
          spacing={0}
          value={state?.marks ?? []}
          disabled={locked}
          aria-label="文字格式"
        >
          {(
            [
              ["bold", "加粗", BoldIcon],
              ["italic", "斜体", ItalicIcon],
              ["underline", "下划线", UnderlineIcon],
            ] as const
          ).map(([name, label, Icon]) => (
            <ToolHint key={name} label={label}>
              <ToggleGroupItem
                value={name}
                aria-label={label}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => {
                  if (!canEdit()) return;
                  const chain = editor!.chain().focus();
                  if (name === "bold") chain.toggleBold().run();
                  else if (name === "italic") chain.toggleItalic().run();
                  else chain.toggleUnderline().run();
                }}
              >
                <Icon />
              </ToggleGroupItem>
            </ToolHint>
          ))}
        </ToggleGroup>
        {action("清除格式", <EraserIcon />, () =>
          editor!.chain().focus().unsetAllMarks().clearNodes().run(),
        )}
        <Separator orientation="vertical" className="h-5" />
        <ToggleGroup
          type="single"
          size="sm"
          spacing={0}
          value={state?.list ?? ""}
          disabled={locked}
          aria-label="列表格式"
        >
          <ToolHint label="无序列表">
            <ToggleGroupItem
              value="bulletList"
              aria-label="无序列表"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                if (canEdit()) editor!.chain().focus().toggleBulletList().run();
              }}
            >
              <ListIcon />
            </ToggleGroupItem>
          </ToolHint>
          <ToolHint label="有序列表">
            <ToggleGroupItem
              value="orderedList"
              aria-label="有序列表"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                if (canEdit())
                  editor!.chain().focus().toggleOrderedList().run();
              }}
            >
              <ListOrderedIcon />
            </ToggleGroupItem>
          </ToolHint>
        </ToggleGroup>
        <ToggleGroup
          type="single"
          size="sm"
          spacing={0}
          value={state?.align ?? "left"}
          disabled={locked}
          aria-label="文字对齐"
          onValueChange={(value) => {
            if (value && canEdit())
              editor!.chain().focus().setTextAlign(value).run();
          }}
        >
          <ToolHint label="左对齐">
            <ToggleGroupItem
              value="left"
              aria-label="左对齐"
              onMouseDown={(event) => event.preventDefault()}
            >
              <AlignLeftIcon />
            </ToggleGroupItem>
          </ToolHint>
          <ToolHint label="居中">
            <ToggleGroupItem
              value="center"
              aria-label="居中"
              onMouseDown={(event) => event.preventDefault()}
            >
              <AlignCenterIcon />
            </ToggleGroupItem>
          </ToolHint>
        </ToggleGroup>
        <Separator orientation="vertical" className="h-5" />
        {action("编辑链接", <LinkIcon />, openLink)}
        {action("上传图片", <ImagePlusIcon />, () => {
          fileSelection.current = editor!.state.selection.getBookmark();
          fileInput.current!.click();
        })}
        {action("插入分页符", <SeparatorHorizontalIcon />, insertPageBreak)}
        {action(
          "撤销",
          <UndoIcon />,
          () => editor!.chain().focus().undo().run(),
          !state?.undo,
        )}
        {action(
          "重做",
          <RedoIcon />,
          () => editor!.chain().focus().redo().run(),
          !state?.redo,
        )}
        <Separator orientation="vertical" className="h-5" />
        <ToolHint label="HTML 源码">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="HTML 源码"
            disabled={sourceLocked}
            onMouseDown={(event) => event.preventDefault()}
            onClick={openSource}
          >
            <CodeXmlIcon />
          </Button>
        </ToolHint>
      </div>
      <input
        ref={fileInput}
        type="file"
        accept={imageTypes.join(",")}
        aria-label="选择正文图片"
        hidden
        disabled={locked}
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          const bookmark = fileSelection.current;
          fileSelection.current = null;
          if (file && bookmark && canEdit())
            void pasteImages(work.current, bookmark, "", "", [file]);
        }}
      />
      {compatibility ? (
        <div className="flex flex-col gap-3 p-3">
          <Alert>
            <InfoIcon />
            <AlertTitle>正文已保护，暂不可编辑</AlertTitle>
            <AlertDescription>
              {compatibility}。标题等信息仍可修改并保存，原始正文保持不变。
            </AlertDescription>
          </Alert>
          <div
            className="cms-editor-body min-h-80"
            aria-label="正文只读预览"
            onClick={(event) => {
              if ((event.target as Element).closest("a"))
                event.preventDefault();
            }}
            dangerouslySetInnerHTML={{ __html: previewHtml(initial.original) }}
          />
        </div>
      ) : (
        <EditorContent editor={editor} />
      )}
      <Dialog
        open={!!source}
        onOpenChange={(open) => {
          if (!open) closeSource();
        }}
      >
        <DialogContent
          className="flex max-h-[85dvh] flex-col sm:max-w-4xl"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (canEdit()) editor!.view.focus();
          }}
        >
          <DialogHeader className="pr-8">
            <DialogTitle>HTML 源码</DialogTitle>
            <DialogDescription>
              {compatibility
                ? "正文处于保护模式，源码仅供查看和复制。"
                : "编辑当前正文的 HTML，应用后返回富文本编辑。仍需保存修改才写入 CMS。"}
            </DialogDescription>
          </DialogHeader>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <Field data-invalid={!!sourceError} data-disabled={sourceLocked}>
              <FieldLabel htmlFor="cms-body-source">正文 HTML</FieldLabel>
              <Textarea
                id="cms-body-source"
                className="h-[50dvh] min-h-40 resize-none field-sizing-fixed font-mono"
                value={source?.html ?? ""}
                readOnly={!!compatibility}
                disabled={sourceLocked}
                aria-invalid={!!sourceError}
                aria-describedby={
                  sourceError ? "cms-body-source-error" : undefined
                }
                spellCheck={false}
                autoCapitalize="off"
                autoCorrect="off"
                wrap="off"
                onChange={(event) => {
                  setSourceError("");
                  setSource(
                    (value) => value && { ...value, html: event.target.value },
                  );
                }}
              />
              {sourceError && (
                <p
                  id="cms-body-source-error"
                  role="alert"
                  className="text-sm text-destructive"
                >
                  未应用修改：{sourceError}
                </p>
              )}
            </Field>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={closeSource}>
              取消
            </Button>
            {!compatibility && (
              <Button type="button" disabled={locked} onClick={applySource}>
                应用
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog
        open={!!link}
        onOpenChange={(open) => {
          if (!open && link) {
            restoreSelection(link.bookmark);
            setLink(null);
          }
        }}
      >
        <DialogContent
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (canEdit()) editor!.view.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>编辑链接</DialogTitle>
            <DialogDescription>
              为选中文字设置链接，留空显示文字时使用链接地址。
            </DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <Field data-invalid={!!linkError}>
              <FieldLabel htmlFor="cms-body-link-url">链接地址</FieldLabel>
              <Input
                id="cms-body-link-url"
                value={link?.href ?? ""}
                aria-invalid={!!linkError}
                onChange={(event) => {
                  setLinkError("");
                  setLink(
                    (value) => value && { ...value, href: event.target.value },
                  );
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    saveLink();
                  }
                }}
              />
            </Field>
            {!link?.hasSelection && (
              <Field>
                <FieldLabel htmlFor="cms-body-link-text">显示文字</FieldLabel>
                <Input
                  id="cms-body-link-text"
                  value={link?.text ?? ""}
                  onChange={(event) =>
                    setLink(
                      (value) =>
                        value && { ...value, text: event.target.value },
                    )
                  }
                />
              </Field>
            )}
          </FieldGroup>
          {linkError && (
            <p role="alert" className="text-sm text-destructive">
              {linkError}
            </p>
          )}
          <DialogFooter>
            {link?.hasLink && (
              <Button
                type="button"
                variant="outline"
                disabled={locked}
                onClick={() => {
                  if (canEdit() && link) {
                    restoreSelection(link.bookmark);
                    editor!.commands.unsetLink();
                    setLink(null);
                  }
                }}
              >
                移除链接
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                if (link) restoreSelection(link.bookmark);
                setLink(null);
              }}
            >
              取消
            </Button>
            <Button type="button" disabled={locked} onClick={saveLink}>
              确定
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
