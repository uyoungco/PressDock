import {
  createHashRouter,
  Navigate,
  Outlet,
  useRouteError,
  isRouteErrorResponse,
  Link,
  useLocation,
} from "react-router-dom";
import { lazy, Suspense } from "react";
import { useIsMobile } from "@/hooks/use-mobile";
import { DesktopLayout } from "@/layouts/DesktopLayout";
import { MobileLayout } from "@/layouts/MobileLayout";
import { Skeleton } from "@/components/ui/skeleton";
import { RequireSession, SessionBoundary } from "@/features/auth/components";
const Login = lazy(() => import("@/pages/Login"));
const Channels = lazy(() => import("@/pages/Channels"));
const Dashboard = lazy(() => import("@/pages/Dashboard"));
const Articles = lazy(() => import("@/pages/Articles"));
const ImportPage = lazy(() => import("@/pages/Import"));
const Editor = lazy(() => import("@/pages/Editor"));
const Images = lazy(() => import("@/pages/Images"));
const Publish = lazy(() => import("@/pages/Publish"));
const Settings = lazy(() => import("@/pages/Settings"));

function Workspace() {
  const mobile = useIsMobile();
  const { pathname } = useLocation();
  const Layout = mobile ? MobileLayout : DesktopLayout;
  return (
    <Layout contentScroll={pathname === "/channels" ? "contained" : "page"}>
      <Suspense
        fallback={
          <Skeleton aria-label="正在加载页面" className="h-64 w-full" />
        }
      >
        <Outlet />
      </Suspense>
    </Layout>
  );
}
function RouteError() {
  const error: unknown = useRouteError();
  return (
    <div role="alert" className="p-8">
      <h1 className="mb-3 text-xl font-semibold">页面加载失败</h1>
      <p className="mb-4 text-muted-foreground">
        {isRouteErrorResponse(error)
          ? error.statusText
          : error instanceof Error
            ? error.message
            : "发生未知错误"}
      </p>
      <Link to="/dashboard" className="underline">
        返回工作台
      </Link>
    </div>
  );
}
export const routes = [
  {
    element: <SessionBoundary />,
    errorElement: <RouteError />,
    children: [
      {
        path: "/login",
        element: (
          <Suspense fallback={<Skeleton className="h-dvh" />}>
            <Login />
          </Suspense>
        ),
      },
      {
        element: (
          <RequireSession>
            <Workspace />
          </RequireSession>
        ),
        children: [
          { index: true, element: <Navigate to="/dashboard" replace /> },
          { path: "/dashboard", element: <Dashboard /> },
          { path: "/articles", element: <Articles /> },
          { path: "/import", element: <ImportPage /> },
          { path: "/editor/:id", element: <Editor /> },
          { path: "/images", element: <Images /> },
          { path: "/publish", element: <Publish /> },
          { path: "/settings", element: <Settings /> },
          { path: "/channels", element: <Channels /> },
          { path: "*", element: <Navigate to="/dashboard" replace /> },
        ],
      },
    ],
  },
];
export const router = createHashRouter(routes);
