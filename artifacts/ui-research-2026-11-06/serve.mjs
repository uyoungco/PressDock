import { fileURLToPath } from "node:url";
import { createServer } from "vite";
const server = await createServer({
  root: fileURLToPath(new URL("../../", import.meta.url)),
  server: { host: "127.0.0.1", port: 18766, strictPort: true, open: false },
});
await server.listen();
console.log("UI 方案调研预览：http://127.0.0.1:18766");
