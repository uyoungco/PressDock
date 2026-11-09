import { fileURLToPath } from "node:url";
import { createServer } from "vite";
const server = await createServer({
  root: fileURLToPath(new URL("../../", import.meta.url)),
  define: {
    "import.meta.env.VITE_PRESSDOCK_PLATFORM": JSON.stringify("android"),
  },
  server: {
    host: "127.0.0.1",
    port: 18786,
    strictPort: true,
    open: false,
    hmr: false,
    watch: null,
  },
});
await server.listen();
console.log(
  "PressDock 手机设计稿 http://127.0.0.1:18786/artifacts/mobile-design-2026-11-06/index.html",
);
