export interface AiProviderConfig {
  providerId: string;
  displayName: string;
  credentialReference: string;
}
export interface TitleSuggestionRequest {
  articleId: string;
  originalTitle: string;
}
export interface AiTask {
  taskId: string;
  cancel(): Promise<void>;
}
// 后续通过 Rust 的安全凭据服务与可取消任务接入；不在前端保存密钥。
