import {
  semanticPaginationSchema,
  type PaginationBlock,
  type SemanticPagination,
} from "./contracts";

export function validateSemanticPagination(
  value: unknown,
  blocks: PaginationBlock[],
): SemanticPagination {
  const result = semanticPaginationSchema.parse(value);
  const positions = new Map(blocks.map((b, i) => [b.id, i]));
  const seen = new Set<string>();
  for (const ids of [result.bind_after, result.prefer_after]) {
    let previous = -1;
    for (const id of ids) {
      const position = positions.get(id);
      if (position === undefined || position <= previous || seen.has(id))
        throw new Error("AI 分页编号无效、重复或冲突，请重新生成");
      previous = position;
      seen.add(id);
    }
  }
  return result;
}

const quotePairs: Readonly<Record<string, string>> = {
  '"': '"',
  "“": "”",
  "‘": "’",
  "「": "」",
  "『": "』",
  "（": "）",
  "(": ")",
};
// 同时用于句界与跨块边界保护；返回值表示当前字符是否为闭合符。
export function trackQuote(stack: string[], character: string) {
  if (stack[stack.length - 1] === character) {
    stack.pop();
    return true;
  }
  if (quotePairs[character]) stack.push(quotePairs[character]);
  return false;
}

// 后端已完成规划；前端仅校验 IPC 分页点的顺序与范围，不维护第二套页长算法。
export function validatePaginationBoundaries(
  ids: string[],
  blocks: PaginationBlock[],
) {
  const positions = new Map(blocks.map((b, i) => [b.id, i]));
  let previous = -1;
  for (const id of ids) {
    const position = positions.get(id);
    if (
      position === undefined ||
      position <= previous ||
      position >= blocks.length - 1
    )
      throw new Error("AI 分页编号无效、重复或顺序错误");
    previous = position;
  }
}
