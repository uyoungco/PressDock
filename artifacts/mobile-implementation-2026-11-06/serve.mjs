import { fileURLToPath } from "node:url";
import { createServer } from "vite";
const server = await createServer({
  root: fileURLToPath(new URL("../../", import.meta.url)),
  define: {
    "import.meta.env.VITE_PRESSDOCK_PLATFORM": JSON.stringify("android"),
  },
  server: {
    host: "127.0.0.1",
    port: 18787,
    strictPort: true,
    open: false,
    hmr: false,
    watch: { ignored: ["**/.tools/**", "**/target/**"] },
  },
});
await server.listen();
console.log(
  "手机端实装验收：http://127.0.0.1:18787/artifacts/mobile-implementation-2026-11-06/channels.html#/channels",
);
