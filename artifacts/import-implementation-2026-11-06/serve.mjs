import { createServer } from "vite";
const android = process.argv.includes("--android");
const server = await createServer({
  root: process.cwd(),
  define: android
    ? { "import.meta.env.VITE_PRESSDOCK_PLATFORM": JSON.stringify("android") }
    : {},
  server: {
    host: "127.0.0.1",
    port: 18769,
    strictPort: true,
    open: false,
    hmr: false,
    watch: null,
  },
});
await server.listen();
console.log(
  `素材导入隔离验收：${android ? "Android" : "桌面"} http://127.0.0.1:18769/artifacts/import-implementation-2026-11-06/index.html#/import`,
);
