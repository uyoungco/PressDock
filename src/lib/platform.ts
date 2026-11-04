// 平台由 Android 构建入口明确注入，布局仍独立按可用宽度选择。
export const isAndroid = () =>
  import.meta.env.VITE_PRESSDOCK_PLATFORM === "android";
export const isDemo = () => import.meta.env.VITE_PRESSDOCK_DEMO === "1";
export const homePath = () => (isAndroid() ? "/channels" : "/dashboard");
export const routeAvailable = (path: string) =>
  !isAndroid() ||
  ["/channels", "/images", "/import", "/settings"].includes(path);
