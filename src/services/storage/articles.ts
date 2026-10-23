import { z } from "zod";
import {
  articleSchema,
  draftInputSchema,
  importUrlSchema,
  type SaveDraftRequest,
} from "@/types/article";
import { invokeCommand } from "@/services/tauri/client";
import type { CmsAdapter } from "@/services/cms/adapter";
import { ServiceError } from "@/services/tauri/client";

export class LocalArticleRepository implements CmsAdapter {
  getArticles() {
    return invokeCommand("list_articles", z.array(articleSchema));
  }
  getArticle(id: string) {
    return invokeCommand("get_article", articleSchema, { id });
  }
  saveDraft(input: SaveDraftRequest) {
    return invokeCommand("save_draft", articleSchema, {
      request: draftInputSchema.parse(input),
    });
  }
  importArticle(input: string) {
    return invokeCommand("create_demo_article", articleSchema, {
      url: importUrlSchema.parse(input),
    });
  }
  async publishArticle(_id: string): Promise<void> {
    throw new ServiceError(
      "NOT_CONFIGURED",
      "CMS 发布接口尚未接入，未执行发布",
    );
  }
}
