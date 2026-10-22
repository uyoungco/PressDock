import { articleService } from "@/services/cms";
import { draftInputSchema, type SaveDraftRequest } from "@/types/article";
export const editorService = {
  load: (id: string) => articleService.getArticle(id),
  save: (request: SaveDraftRequest) =>
    articleService.saveDraft(draftInputSchema.parse(request)),
};
