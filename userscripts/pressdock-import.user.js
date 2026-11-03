// ==UserScript==
// @name         PressDock 一键导入素材
// @namespace    pressdock
// @version      1.0.0
// @description  将当前文章链接加入 PressDock 采集队列，在软件中查看最终结果。
// @match        *://baijiahao.baidu.com/*
// @match        *://mbd.baidu.com/*
// @connect      127.0.0.1
// @grant        GM_xmlhttpRequest
// @run-at       document-idle
// @noframes
// ==/UserScript==

(() => {
  "use strict";

  if (
    window.top !== window.self ||
    !["baijiahao.baidu.com", "mbd.baidu.com"].includes(location.hostname) ||
    document.getElementById("pressdock-import")
  )
    return;

  // Shadow DOM 隔离来源网页的样式；正文、登录信息及站点 Cookie 均不参与导入。
  const host = document.createElement("div");
  host.id = "pressdock-import";
  host.style.cssText =
    "all:initial;position:fixed;right:24px;bottom:24px;z-index:2147483647";
  const root = host.attachShadow({ mode: "closed" });
  const style = document.createElement("style");
  style.textContent = `
    :host { color-scheme: light; }
    .panel { display:flex;flex-direction:column;align-items:flex-end;gap:10px;font:14px/1.5 system-ui,sans-serif; }
    button { border:0;border-radius:10px;padding:12px 18px;background:#18181b;color:#fff;font:inherit;cursor:pointer;box-shadow:0 4px 20px #0003; }
    button:hover { background:#3f3f46; }
    button:focus-visible { outline:3px solid #2563eb;outline-offset:3px; }
    button:disabled { opacity:.65;cursor:wait; }
    p { margin:0;max-width:min(320px,calc(100vw - 64px));padding:12px 16px;border-radius:10px;background:#fff;color:#18181b;box-shadow:0 4px 20px #0003;overflow-wrap:anywhere; }
    p:empty { display:none; }
    p[data-error="true"] { color:#b91c1c; }
  `;
  const panel = document.createElement("div");
  panel.className = "panel";
  const message = document.createElement("p");
  message.setAttribute("role", "status");
  message.setAttribute("aria-live", "polite");
  const button = document.createElement("button");
  button.type = "button";
  button.textContent = "导入 PressDock";
  panel.append(message, button);
  root.append(style, panel);
  document.body.append(host);

  let pending = null;
  button.addEventListener("click", () => {
    if (button.disabled) return;
    const url = new URL(location.href);
    url.hash = "";
    // 超时或网络异常后保留同一 URL 的请求 ID，手动重试不会重复入队。
    if (pending?.url !== url.href) {
      const bytes = crypto.getRandomValues(new Uint8Array(16));
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      const hex = Array.from(bytes, (byte) =>
        byte.toString(16).padStart(2, "0"),
      ).join("");
      const id = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
      pending = { id, url: url.href };
    }
    button.disabled = true;
    button.textContent = "正在加入队列…";
    message.textContent = "";
    let settled = false;
    let timer;
    const finish = (text, failed = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      message.textContent = text;
      message.dataset.error = String(failed);
      button.disabled = false;
      button.textContent = "导入 PressDock";
    };
    const timeout = () =>
      finish(
        "连接超时，请确认 PressDock 已启动；可再次点击，最终结果请到采集记录查看。",
        true,
      );
    let request;
    try {
      request = GM_xmlhttpRequest({
        method: "POST",
        url: "http://127.0.0.1:18765/api/v1/harvest",
        headers: {
          "Content-Type": "application/json",
          "X-PressDock-Client": "userscript-v1",
        },
        anonymous: true,
        data: JSON.stringify(pending),
        onload: (response) => {
          // 已超时请求的迟到回调不得清理下一次手动重试的请求 ID。
          if (settled) return;
          try {
            const result = JSON.parse(response.responseText);
            if (response.status !== 200) {
              finish(
                result.code === "AUTH_EXPIRED"
                  ? "请先在 PressDock 中登录，再点击导入。"
                  : result.message || "导入失败，请到 PressDock 查看连接状态。",
                true,
              );
              return;
            }
            // 校验本机协议响应，不能把其他程序占用端口时的响应当作入队成功。
            if (
              typeof result.jobId !== "string" ||
              typeof result.collectionDate !== "string"
            )
              throw new Error("无效的入队响应");
            const messages = {
              queued:
                result.jobId === pending.id
                  ? "已加入采集队列，请到 PressDock 的采集记录查看结果。"
                  : "该文章已在采集队列，请到 PressDock 查看进度。",
              running: "该文章已在队列处理中，请到 PressDock 查看进度。",
              succeeded: "该文章已添加到 CMS，可到 PressDock 查看采集记录。",
              debugCompleted:
                "已有调试采集记录，未提交 CMS，请到 PressDock 查看。",
              waitingUser:
                "该文章正在等待网页验证或标签页选择，请到 PressDock 继续。",
              waitingLogin: "该文章正在等待重新登录，请到 PressDock 继续。",
              failed: "已有失败记录，请到 PressDock 查看原因并重试。",
              cancelled: "已有取消记录，请到 PressDock 重试。",
              interrupted: "已有中断记录，请到 PressDock 重试。",
              submissionUnknown:
                "提交结果待确认，请到 PressDock 核对，避免重复添加。",
            };
            if (!Object.hasOwn(messages, result.status))
              throw new Error("未知的采集状态");
            const failed = [
              "failed",
              "cancelled",
              "interrupted",
              "submissionUnknown",
            ].includes(result.status);
            finish(messages[result.status], failed);
            pending = null;
          } catch {
            finish(
              "软件返回了无法识别的响应，请到 PressDock 查看连接状态和采集记录。",
              true,
            );
          }
        },
        onerror: () =>
          finish(
            "无法连接 PressDock，请先启动软件；若已启动，请到采集设置查看连接状态。",
            true,
          ),
        ontimeout: timeout,
        onabort: timeout,
      });
      // anonymous 使用的浏览器 fetch 模式可能忽略 timeout，显式计时并中止请求。
      timer = setTimeout(() => {
        timeout();
        request.abort();
      }, 10000);
    } catch {
      finish(
        "无法发送导入请求，请确认油猴已允许此脚本连接本机 PressDock。",
        true,
      );
    }
  });
})();
