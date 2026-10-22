export const IMAGE_RATIOS = [
  { value: "original", label: "原始比例" },
  { value: "16/9", label: "16:9 横图" },
  { value: "4/3", label: "4:3 标准" },
  { value: "1/1", label: "1:1 方图" },
  { value: "3/4", label: "3:4 竖图" },
] as const;
export type ImageRatio = (typeof IMAGE_RATIOS)[number]["value"];
export const MAX_IMAGE_SIZE = 20 * 1024 * 1024;
