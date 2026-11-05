// 平台由 Android 构建入口明确注入，布局仍独立按可用宽度选择。
export const isAndroid = () =>
  import.meta.env.VITE_PRESSDOCK_PLATFORM === "android";
export const isDemo = () => import.meta.env.VITE_PRESSDOCK_DEMO === "1";
export const homePath = () => (isAndroid() ? "/channels" : "/dashboard");
export const routeAvailable = (path: string) =>
  !isAndroid() ||
  ["/channels", "/images", "/import", "/settings"].includes(path) ||
  // 仅开放已实现的四个文章类别，不放行任意文章子路径。
  /^\/articles(?:\/(?:quality|review-[123]))?$/.test(path);
