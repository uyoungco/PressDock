import { photoCraftIpc } from "@/services/tauri/photocraft";

// 独立工具服务只负责启动，不接入现有图片、素材或 CMS 数据。
export const photoCraftService = photoCraftIpc;
