import { z } from "zod";

const text = (max: number) =>
  z
    .string()
    .refine((v) => !!v.trim() && [...v].length <= max, `须为 1–${max} 字符`);
export const protocolSchema = z.enum(["chatCompletions", "responses"]);
export const compatibilitySchema = z.object({
  maxTokensField: z.enum(["max_completion_tokens", "max_tokens"]),
  systemRole: z.enum(["system", "developer"]),
  sendStore: z.boolean(),
});
export const defaultCompatibility = {
  maxTokensField: "max_completion_tokens",
  systemRole: "system",
  sendStore: true,
} as const;
const providerFields = {
  id: z
    .string()
    .regex(
      /^[a-z][a-z0-9-]{0,63}$/,
      "以小写字母开头，只能包含小写字母、数字和连字符，最多 64 字符",
    ),
  displayName: text(100),
  baseUrl: z
    .string()
    .max(2048)
    .refine((value) => {
      try {
        const url = new URL(value);
        return (
          (url.protocol === "https:" ||
            (url.protocol === "http:" &&
              ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        );
      } catch {
        return false;
      }
    }, "API 地址须为 HTTPS（本机允许 HTTP），不能包含认证信息、查询参数或片段"),
  protocol: protocolSchema,
  compatibility: compatibilitySchema,
};
export const providerSchema = z.object({
  ...providerFields,
  hasApiKey: z.boolean(),
});
export const saveProviderSchema = z.object({
  ...providerFields,
  createOnly: z.boolean().optional(),
  apiKey: z
    .string()
    .min(1)
    .refine(
      (v) =>
        !!v.trim() &&
        new TextEncoder().encode(v).length <= 8192 &&
        !/\p{Cc}/u.test(v),
      "API 密钥无效",
    )
    .nullable()
    .optional(),
});
export const modelSchema = z
  .object({
    id: text(100),
    providerId: text(64),
    modelId: text(200),
    displayName: text(100),
    contextWindow: z.number().int().positive().max(4_294_967_295).nullable(),
    maxOutputTokens: z.number().int().positive().max(4_294_967_295).nullable(),
    reasoningEffort: z.enum(["low", "medium", "high"]).nullable(),
  })
  .refine(
    (m) =>
      m.contextWindow === null ||
      m.maxOutputTokens === null ||
      m.maxOutputTokens <= m.contextWindow,
    "输出上限不能超过上下文窗口",
  );
export const templateVariables = [
  "title",
  "content",
  "count",
  "max_length",
  "requirements",
] as const;
export const paginationVariables = ["title", "blocks"] as const;
export function validateVariables(value: string, purpose = "title"): boolean {
  const variables: readonly string[] =
    purpose === "pagination" ? paginationVariables : templateVariables;
  const pattern = /\{\{([\s\S]*?)\}\}/g;
  for (const match of value.matchAll(pattern)) {
    if (!variables.includes(match[1].trim())) return false;
  }
  return !value.replace(pattern, "").includes("{{");
}
export const countSchema = z.number().int().min(1).max(10);
export const lengthSchema = z.number().int().min(1).max(200);
const prompt = z
  .string()
  .refine((v) => [...v].length <= 20_000, "提示词最多 20000 字符");
export const paginationOptionsSchema = z
  .object({
    minChars: z.number().int().min(1).max(10_000),
    targetChars: z.number().int().min(1).max(10_000),
    maxChars: z.number().int().min(1).max(10_000),
  })
  .refine(
    (v) => v.minChars <= v.targetChars && v.targetChars <= v.maxChars,
    "页长须满足：最少字数 ≤ 目标字数 ≤ 最多字数",
  );
export const defaultPaginationOptions = {
  minChars: 100,
  targetChars: 240,
  maxChars: 400,
};
export const templateSchema = z
  .object({
    purpose: z.enum(["title", "pagination"]).default("title"),
    paginationOptions: paginationOptionsSchema.nullable().default(null),
    id: text(100),
    name: text(100),
    systemPrompt: prompt,
    userPrompt: prompt.refine((v) => !!v.trim(), "请输入用户提示词"),
    modelConfigId: text(100).nullable(),
    candidateCount: countSchema,
    maxLength: lengthSchema,
    isDefault: z.boolean(),
  })
  .superRefine((v, ctx) => {
    for (const key of ["systemPrompt", "userPrompt"] as const) {
      if (!validateVariables(v[key], v.purpose))
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "存在未知或未闭合的模板变量",
        });
    }
    if (v.purpose === "pagination" && !v.paginationOptions)
      ctx.addIssue({
        code: "custom",
        path: ["paginationOptions"],
        message: "请配置分页页长",
      });
  });
export const settingsSchema = z.object({
  providers: providerSchema.array(),
  models: modelSchema.array(),
  templates: templateSchema.array(),
});
export const suggestionRequestSchema = z
  .object({
    jobId: z.uuid(),
    templateId: text(100),
    title: z.string().refine((v) => [...v].length <= 20_000, "标题过长"),
    content: z
      .string()
      .refine(
        (v) => new TextEncoder().encode(v).length <= 4_000_000,
        "正文最多 4 MB",
      ),
    modelConfigId: text(100).nullable().optional(),
    candidateCount: countSchema.nullable().optional(),
    maxLength: lengthSchema.nullable().optional(),
    requirements: z
      .string()
      .refine((v) => [...v].length <= 2000, "补充要求最多 2000 字符"),
  })
  .refine(
    (r) => !!r.title.trim() || !!r.content.trim(),
    "请先填写标题或参考正文",
  );
export const suggestionResultSchema = z.object({
  jobId: z.uuid(),
  templateId: text(100),
  modelConfigId: text(100),
  candidates: z.array(text(200)).min(1).max(10),
  requestedCount: countSchema,
});
export type AiProviderConfig = z.infer<typeof providerSchema>;
export type SaveProviderRequest = z.infer<typeof saveProviderSchema>;
export type AiModelConfig = z.infer<typeof modelSchema>;
export type PromptTemplate = z.infer<typeof templateSchema>;
export type AiSettings = z.infer<typeof settingsSchema>;
export type TitleSuggestionRequest = z.infer<typeof suggestionRequestSchema>;
export type TitleSuggestionResult = z.infer<typeof suggestionResultSchema>;
export const paginationBlockSchema = z.object({
  id: z.string().regex(/^B[1-9]\d*$/),
  type: z.enum(["text", "image", "caption", "heading", "source"]),
  paragraph: z.number().int().nonnegative(),
  text: z.string().optional(),
  chars: z.number().int().nonnegative(),
  caption_of: z.string().optional(),
  keep_with_next: z.boolean().optional(),
});
export const paginationRequestSchema = z
  .object({
    jobId: z.uuid(),
    templateId: text(100),
    modelConfigId: text(100),
    title: z.string().refine((v) => [...v].length <= 20_000, "标题过长"),
    blocks: paginationBlockSchema.array().min(1).max(10_000),
  })
  .refine(
    (r) =>
      new TextEncoder().encode(JSON.stringify(r.blocks)).length <= 4_000_000,
    "分页内容最多 4 MB",
  );
export const semanticPaginationSchema = z.strictObject({
  bind_after: z.string().array(),
  prefer_after: z.string().array(),
});
export const paginationResultSchema = z.object({
  jobId: z.uuid(),
  templateId: text(100),
  modelConfigId: text(100),
  ...semanticPaginationSchema.shape,
  breakAfter: z.string().array(),
  paginationOptions: paginationOptionsSchema,
});
export type PaginationBlock = z.infer<typeof paginationBlockSchema>;
export type PaginationOptions = z.infer<typeof paginationOptionsSchema>;
export type SemanticPagination = z.infer<typeof semanticPaginationSchema>;
export type PaginationRequest = z.infer<typeof paginationRequestSchema>;
export const emptySettings: AiSettings = {
  providers: [],
  models: [],
  templates: [],
};
