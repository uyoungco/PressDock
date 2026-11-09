import { fileURLToPath } from "node:url";
import { createServer } from "vite";
const server = await createServer({
  root: fileURLToPath(new URL("../../", import.meta.url)),
  define: {
    "import.meta.env.VITE_PRESSDOCK_PLATFORM": JSON.stringify("android"),
  },
  server: {
    host: "127.0.0.1",
    port: 18782,
    strictPort: true,
    open: false,
    hmr: false,
    watch: null,
  },
});
await server.listen();
console.log(
  "Android 分支 · 系统设置隔离演示 http://127.0.0.1:18782/artifacts/settings-implementation-2026-11-06/index.html#/settings",
);
