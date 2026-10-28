import { Extension, getSchema } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import { Placeholder } from "@tiptap/extensions";
import { DOMParser as SchemaParser, DOMSerializer } from "@tiptap/pm/model";
import DOMPurify from "dompurify";

export const pageBreak = "[!--empirenews.page--]";
const dimensions = ["width", "height", "max-width", "max-height"];
const blocks = new Set([
  "P",
  "H1",
  "H2",
  "H3",
  "H4",
  "H5",
  "H6",
  "UL",
  "OL",
  "LI",
  "BLOCKQUOTE",
  "PRE",
  "HR",
]);
const inlineTags = new Set([
  "SPAN",
  "STRONG",
  "B",
  "EM",
  "I",
  "U",
  "S",
  "STRIKE",
  "DEL",
  "CODE",
  "A",
  "IMG",
  "BR",
]);

function dimension(element: HTMLElement, name: string) {
  const value =
    element.style.getPropertyValue(name) || element.getAttribute(name);
  return value && /^\d+(?:\.\d+)?$/.test(value) ? `${value}px` : value;
}

// CMS 的图注和图片尺寸不在默认 schema 中，显式声明，避免编辑后静默丢失。
export const editorExtensions = [
  StarterKit.configure({
    trailingNode: false,
    link: {
      openOnClick: false,
      autolink: false,
      linkOnPaste: false,
      HTMLAttributes: { target: null, rel: null, class: null },
    },
  }),
  Image.extend({
    addAttributes() {
      return {
        ...this.parent?.(),
        ...Object.fromEntries(
          dimensions.map((name) => [
            name,
            {
              default: null,
              parseHTML: (element: HTMLElement) => dimension(element, name),
              renderHTML: (attributes: Record<string, string | null>) =>
                attributes[name]
                  ? { style: `${name}: ${attributes[name]}` }
                  : {},
            },
          ]),
        ),
      };
    },
  }).configure({ inline: true, allowBase64: false }),
  TextAlign.configure({ types: ["heading", "paragraph"] }),
  Placeholder.configure({ placeholder: "请输入正文…" }),
  Extension.create({
    name: "cmsCaption",
    addGlobalAttributes() {
      return [
        {
          types: ["paragraph"],
          attributes: {
            class: {
              default: null,
              parseHTML: (element: HTMLElement) =>
                element.classList.contains("img-caption")
                  ? "img-caption"
                  : null,
            },
          },
        },
      ];
    },
  }),
];
const schema = getSchema(editorExtensions);

export function cleanHtml(html: string) {
  return DOMPurify.sanitize(html, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: [
      "style",
      "form",
      "input",
      "button",
      "iframe",
      "video",
      "audio",
    ],
    ALLOW_DATA_ATTR: false,
  });
}

export function previewHtml(html: string) {
  // 保护模式只展示净化后的静态内容；历史样式不能覆盖抽屉或其他应用界面。
  return DOMPurify.sanitize(cleanHtml(html), {
    FORBID_ATTR: ["style", "class", "id"],
  });
}

function wrapInline(parent: Element) {
  let paragraph: HTMLParagraphElement | null = null;
  for (const child of Array.from(parent.childNodes)) {
    if (child instanceof Element && blocks.has(child.tagName)) {
      paragraph = null;
    } else if (child.nodeType !== Node.TEXT_NODE || child.textContent?.trim()) {
      if (!paragraph) {
        paragraph = parent.ownerDocument.createElement("p");
        child.before(paragraph);
      }
      paragraph.append(child);
    } else if (paragraph) {
      paragraph.append(child);
    } else {
      child.remove();
    }
  }
}

function splitPageBreaks(body: HTMLElement) {
  for (let block of body.querySelectorAll("p,h1,h2,h3,h4,h5,h6")) {
    // 用 DOM Range 拆段，保留分页前后的嵌套格式，不在 HTML 字符串中拼接闭合标签。
    while (block.textContent?.includes(pageBreak)) {
      if (block.textContent === pageBreak) {
        const marker = body.ownerDocument.createElement("p");
        marker.textContent = pageBreak;
        block.replaceWith(marker);
        break;
      }
      const walker = body.ownerDocument.createTreeWalker(
        block,
        NodeFilter.SHOW_TEXT,
      );
      const index = block.textContent.indexOf(pageBreak);
      const before = body.ownerDocument.createRange();
      before.selectNodeContents(block);
      const after = before.cloneRange();
      let offset = 0;
      let started = false;
      let text: Node | null;
      while ((text = walker.nextNode())) {
        const end = offset + text.textContent!.length;
        // 标记可能跨越多个格式节点，按整段文字偏移定位，避免循环停在半个标记上。
        if (!started && index < end) {
          before.setEnd(text, index - offset);
          started = true;
        }
        if (index + pageBreak.length > end) {
          offset = end;
          continue;
        }
        after.setStart(text, index + pageBreak.length - offset);
        const prefix = block.cloneNode(false) as Element;
        prefix.append(before.cloneContents());
        const suffix = block.cloneNode(false) as Element;
        suffix.append(after.cloneContents());
        const marker = body.ownerDocument.createElement("p");
        marker.textContent = pageBreak;
        block.replaceWith(prefix, marker, suffix);
        block = suffix;
        break;
      }
    }
  }
}

export function prepareHtml(html: string) {
  const raw = new DOMParser().parseFromString(html, "text/html");
  const document = new DOMParser().parseFromString(
    cleanHtml(html),
    "text/html",
  );
  const issues = new Set<string>();
  // 净化会删除嵌入节点，所以先检查原始 DOM，防止“先丢失、后校验”。
  raw
    .querySelectorAll(
      "table,iframe,video,audio,object,embed,svg,math,canvas,picture,form,input,select,textarea,button,style",
    )
    .forEach((element) => {
      issues.add(`不支持的结构：${element.tagName.toLowerCase()}`);
    });
  for (const element of document.body.querySelectorAll<HTMLElement>("*")) {
    const tag = element.tagName;
    const wrapper = ["DIV", "SECTION", "ARTICLE"].includes(tag);
    if (!blocks.has(tag) && !inlineTags.has(tag) && !wrapper)
      issues.add(`不支持的结构：${tag.toLowerCase()}`);
    for (const attribute of Array.from(element.attributes)) {
      const { name, value } = attribute;
      if (
        [
          "style",
          "contenteditable",
          "draggable",
          "loading",
          "decoding",
        ].includes(name)
      )
        continue;
      if (
        name === "class" &&
        (!value ||
          (tag === "P" && value === "img-caption") ||
          (tag === "CODE" && /^language-[\w+-]+$/.test(value)))
      )
        continue;
      if (
        tag === "IMG" &&
        ["src", "alt", "title", "width", "height"].includes(name)
      )
        continue;
      if (tag === "A" && ["href", "title", "target", "rel"].includes(name))
        continue;
      if (tag === "OL" && name === "start") continue;
      if (name === "align" && /^P$|^H[1-6]$/.test(tag)) {
        element.style.textAlign = value;
        element.removeAttribute("align");
        continue;
      }
      issues.add(`不支持的属性：${tag.toLowerCase()}.${name}`);
    }
    for (const property of Array.from(element.style)) {
      const value = element.style.getPropertyValue(property);
      const supported =
        (tag === "IMG" && dimensions.includes(property)) ||
        (/^P$|^H[1-6]$/.test(tag) &&
          property === "text-align" &&
          ["left", "center", "right", "justify"].includes(value)) ||
        (!wrapper &&
          property === "font-weight" &&
          /^(normal|bold|[1-9]00)$/.test(value)) ||
        (!wrapper &&
          property === "font-style" &&
          /^(normal|italic)$/.test(value)) ||
        (!wrapper &&
          ["text-decoration", "text-decoration-line"].includes(property) &&
          /^(none|underline|line-through|underline line-through)$/.test(
            value,
          )) ||
        // 浏览器会将 text-decoration 简写展开为默认长属性，这些值不增加样式语义。
        (!wrapper &&
          ((property === "text-decoration-thickness" &&
            ["auto", "initial"].includes(value)) ||
            (property === "text-decoration-style" &&
              ["solid", "initial"].includes(value)) ||
            (property === "text-decoration-color" &&
              ["currentcolor", "initial"].includes(value))));
      if (!supported || element.style.getPropertyPriority(property))
        issues.add(`不支持的样式：${property}`);
    }
    if (element.getAttribute("style")?.trim() && !element.style.length)
      issues.add("无法识别的样式");
    if (tag === "IMG" && element.getAttribute("src")?.startsWith("//"))
      element.setAttribute("src", `https:${element.getAttribute("src")}`);
  }
  // 无样式容器仅承担段落包装，先规范化，避免误把包装差异判为正文丢失。
  Array.from(document.body.querySelectorAll("div,section,article"))
    .reverse()
    .forEach((element) => {
      wrapInline(element);
      element.replaceWith(...element.childNodes);
    });
  document.body.querySelectorAll("li,blockquote").forEach(wrapInline);
  wrapInline(document.body);
  splitPageBreaks(document.body);
  if (!document.body.childNodes.length)
    document.body.append(document.createElement("p"));
  return { body: document.body, issue: Array.from(issues).join("；") };
}

function signature(root: Element) {
  const tokens: [string, string, string][] = [];
  function visit(node: Node, inherited: string[]) {
    if (node.nodeType === Node.TEXT_NODE) {
      const marks = JSON.stringify([...inherited].sort());
      const previous = tokens[tokens.length - 1];
      if (previous?.[0] === "text" && previous[2] === marks)
        previous[1] += node.textContent;
      else tokens.push(["text", node.textContent ?? "", marks]);
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    const tag = node.tagName;
    const marks = [...inherited];
    if (
      ["STRONG", "B"].includes(tag) ||
      /^(bold|[5-9]00)$/.test(node.style.fontWeight)
    )
      marks.push("bold");
    if (["EM", "I"].includes(tag) || node.style.fontStyle === "italic")
      marks.push("italic");
    const decoration =
      node.style.textDecorationLine || node.style.textDecoration;
    if (tag === "U" || decoration.includes("underline"))
      marks.push("underline");
    if (
      ["S", "DEL", "STRIKE"].includes(tag) ||
      decoration.includes("line-through")
    )
      marks.push("strike");
    if (tag === "CODE" && node.parentElement?.tagName !== "PRE")
      marks.push("code");
    if (tag === "A" && node.hasAttribute("href"))
      marks.push(
        JSON.stringify([
          "link",
          ...["href", "title", "target", "rel"].map(
            (name) => node.getAttribute(name) || "",
          ),
        ]),
      );
    const active = [...new Set(marks)].sort();
    if (tag === "IMG") {
      tokens.push([
        "image",
        JSON.stringify([
          ...["src", "alt", "title"].map(
            (name) => node.getAttribute(name) || "",
          ),
          ...dimensions.map((name) => dimension(node, name) || ""),
        ]),
        JSON.stringify(active),
      ]);
      return;
    }
    if (tag === "BR") {
      tokens.push(["break", "", JSON.stringify(active)]);
      return;
    }
    const attributes = JSON.stringify([
      node.classList.contains("img-caption") ? "img-caption" : "",
      node.style.textAlign || "",
      tag === "OL" ? node.getAttribute("start") || "1" : "",
      tag === "PRE" ? node.querySelector("code")?.className || "" : "",
    ]);
    if (blocks.has(tag)) tokens.push(["open", tag, attributes]);
    node.childNodes.forEach((child) => visit(child, active));
    if (blocks.has(tag)) tokens.push(["close", tag, ""]);
  }
  root.childNodes.forEach((child) => visit(child, []));
  return JSON.stringify(tokens);
}

export function parseCompatible(body: HTMLElement) {
  const doc = SchemaParser.fromSchema(schema).parse(body, {
    preserveWhitespace: "full",
  });
  const serialized = body.ownerDocument.createElement("div");
  serialized.append(
    DOMSerializer.fromSchema(schema).serializeFragment(doc.content),
  );
  // 白名单之外再比较语义往返：HTML 的 contentError 无法发现所有属性和 mark 丢失。
  if (signature(body) !== signature(serialized))
    throw new Error("正文解析后存在格式或内容差异，已保护原文");
  return doc;
}
