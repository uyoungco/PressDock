import { fileURLToPath } from "node:url";
import { createServer } from "vite";
const android = process.argv.includes("--android");
const server = await createServer({
  root: fileURLToPath(new URL("../../", import.meta.url)),
  define: android
    ? { "import.meta.env.VITE_PRESSDOCK_PLATFORM": JSON.stringify("android") }
    : {},
  server: {
    host: "127.0.0.1",
    port: 18770,
    strictPort: true,
    open: false,
    hmr: false,
    watch: null,
  },
});
await server.listen();
console.log(
  `文章管理设计调研隔离预览 ${android ? "Android" : "桌面"} http://127.0.0.1:18770/artifacts/articles-design-2026-11-06/current.html#/articles/quality`,
);
