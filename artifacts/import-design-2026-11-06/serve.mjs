import { createServer } from "vite";

const server = await createServer({
  root: process.cwd(),
  server: {
    host: "127.0.0.1",
    port: 18768,
    strictPort: true,
    open: false,
    hmr: false,
    watch: null,
  },
});
await server.listen();
console.log(
  "素材导入设计稿 · 隔离演示 http://127.0.0.1:18768/artifacts/import-design-2026-11-06/",
);
