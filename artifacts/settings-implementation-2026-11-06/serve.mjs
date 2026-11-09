import { fileURLToPath } from "node:url";
import { createServer } from "vite";
const server = await createServer({
  root: fileURLToPath(new URL("../../", import.meta.url)),
  server: {
    host: "127.0.0.1",
    port: 18781,
    strictPort: true,
    open: false,
    hmr: false,
    watch: null,
  },
});
await server.listen();
console.log(
  "系统设置实施 · 隔离演示 http://127.0.0.1:18781/artifacts/settings-implementation-2026-11-06/index.html#/settings",
);
