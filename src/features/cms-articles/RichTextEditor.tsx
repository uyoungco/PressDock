import { useEffect, useRef } from "react";
import {
  createEditor,
  createToolbar,
  type IDomEditor,
} from "@wangeditor/editor";
import DOMPurify from "dompurify";
import { articleService } from "./service";
import "@wangeditor/editor/dist/css/style.css";

function cleanHtml(html: string) {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["form", "input", "button", "iframe", "video", "audio"],
    ALLOW_DATA_ATTR: false,
  });
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
  const toolbar = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const instance = useRef<IDomEditor | null>(null);
  const latest = useRef({ initialHtml, onChange, onUploading, onError });
  latest.current = { initialHtml, onChange, onUploading, onError };
  useEffect(() => {
    let active = true;
    let initialized = false;
    let pendingUploads = 0;
    let baseline = "";
    const original = latest.current.initialHtml;
    // 原站 HTML 在渲染边界清理，分页标记独立成段；仅展示时补全图片协议。
    const document = new DOMParser().parseFromString(
      cleanHtml(original).replace(
        /(?:<p>\s*)?\[!--empirenews\.page--\](?:\s*<\/p>)?/g,
        "<p>[!--empirenews.page--]</p>",
      ),
      "text/html",
    );
    document.querySelectorAll("img").forEach((image) => {
      const source = image.getAttribute("src");
      if (source?.startsWith("//"))
        image.setAttribute("src", `https:${source}`);
    });
    const editor = createEditor({
      selector: body.current!,
      html: document.body.innerHTML,
      config: {
        placeholder: "请输入正文…",
        scroll: false,
        customAlert(message: string) {
          latest.current.onError(message);
        },
        customPaste(editor, event) {
          const html = event.clipboardData?.getData("text/html");
          if (!html) return true;
          event.preventDefault();
          editor.dangerouslyInsertHtml(cleanHtml(html));
          return false;
        },
        MENU_CONF: {
          uploadImage: {
            maxNumberOfFiles: 1,
            maxFileSize: 20 * 1024 * 1024,
            allowedFileTypes: ["image/jpeg", "image/png", "image/webp"],
            async customUpload(file: File, insert: (url: string) => void) {
              pendingUploads += 1;
              latest.current.onUploading(true);
              try {
                const result = await articleService.upload(file);
                if (active) insert(result.url);
              } catch (error) {
                if (active)
                  latest.current.onError(
                    error instanceof Error ? error.message : "图片上传失败",
                  );
              } finally {
                pendingUploads -= 1;
                if (active) latest.current.onUploading(pendingUploads > 0);
              }
            },
          },
        },
        onChange(editor) {
          if (!initialized || !active) return;
          const html = editor.getHtml();
          // 元数据编辑和撤销到初始内容时保留原始字节，避免无意重排正文。
          latest.current.onChange(
            html === baseline ? original : cleanHtml(html),
          );
        },
      },
    });
    createToolbar({
      editor,
      selector: toolbar.current!,
      config: {
        toolbarKeys: [
          "headerSelect",
          "bold",
          "italic",
          "underline",
          "clearStyle",
          "|",
          "bulletedList",
          "numberedList",
          "justifyLeft",
          "justifyCenter",
          "|",
          "insertLink",
          "uploadImage",
          "undo",
          "redo",
        ],
      },
    });
    baseline = editor.getHtml();
    initialized = true;
    instance.current = editor;
    return () => {
      active = false;
      instance.current = null;
      editor.destroy();
    };
  }, []);
  useEffect(() => {
    if (disabled) instance.current?.disable();
    else instance.current?.enable();
  }, [disabled]);
  return (
    <div className="cms-rich-editor min-w-0 overflow-hidden rounded-md border">
      <div ref={toolbar} className="border-b" />
      <div ref={body} aria-label="文章正文" className="min-h-80" />
    </div>
  );
}
