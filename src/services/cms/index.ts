import { isDesktop } from "@/services/tauri/client";
import { LocalArticleRepository } from "@/services/storage/articles";
import { MockCmsAdapter } from "./mock";
import type { CmsAdapter } from "./adapter";

export const articleService: CmsAdapter = isDesktop()
  ? new LocalArticleRepository()
  : new MockCmsAdapter();
