import { createServer } from "vite";
const server = await createServer({
  root: process.cwd(),
  server: {
    host: "127.0.0.1",
    port: 18767,
    strictPort: true,
    open: false,
    hmr: false,
    watch: null,
  },
});
await server.listen();
console.log(
  "渠道选择器隔离验收：http://127.0.0.1:18767/artifacts/selector-scroll-fix-2026-11-06/index.html",
);
