import { fileURLToPath } from "node:url";
import { createServer } from "vite";
const server = await createServer({
  root: fileURLToPath(new URL("../../", import.meta.url)),
  server: {
    host: "127.0.0.1",
    port: 18780,
    strictPort: true,
    open: false,
    hmr: false,
    watch: null,
  },
});
await server.listen();
console.log(
  "系统设置隔离调研 http://127.0.0.1:18780/artifacts/settings-design-2026-11-06/current.html#/settings",
);
