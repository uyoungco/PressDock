import { Link } from "react-router-dom";
import {
  ArrowRight,
  Download,
  FilePenLine,
  Info,
  LayoutList,
  RefreshCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isDemo } from "@/lib/platform";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useDashboard } from "@/features/dashboard/use-dashboard";
import { RecentHarvest } from "@/features/dashboard/RecentHarvest";
import { QueryNotice } from "@/features/dashboard/QueryNotice";
import { reviewOverviewLink } from "@/features/dashboard/model";
import "./dashboard.css";

export default function Dashboard() {
  const dashboard = useDashboard();
  const {
    date,
    stats,
    harvest,
    reviews,
    reviewTotal,
    refreshing,
    refresh,
    openToday,
  } = dashboard;
  const demo = isDemo();
  const cards = [
    {
      id: "today",
      label: "今日采集",
      value: stats?.today,
      scope: "本机",
      detail: stats ? `已添加 CMS ${stats.succeeded} 条` : "当天入队的正式任务",
    },
    {
      id: "active",
      label: "进行中",
      value: stats?.active,
      detail: "排队中与正在处理",
    },
    {
      id: "attention",
      label: "需处理",
      value: stats?.attention,
      detail: "验证、登录、中断或异常",
    },
    {
      id: "cms",
      label: "CMS 待审核",
      value: reviewTotal,
      scope: "全部",
      detail: "当前账号可见的三级待审核总数",
    },
  ];
  const weekday = new Date(`${date}T12:00:00`).toLocaleDateString("zh-CN", {
    weekday: "long",
  });
  const reviewErrors = reviews
    .filter((review) => review.error)
    .map(
      (review) =>
        `${review.view === "review-1" ? "一级" : review.view === "review-2" ? "二级" : "三级"}：${review.error?.message}`,
    );
  return (
    <ScrollArea className="min-h-0 min-w-0 flex-1">
      <div
        className="dashboard-workspace @container/dashboard flex min-w-0 flex-col p-px"
        data-dashboard
      >
        <header className="dashboard-header">
          <div className="dashboard-heading">
            <h1>工作台</h1>
            <div className="dashboard-date">
              <time dateTime={date}>{date.replace(/-/g, ".")}</time>
              <span className="dashboard-weekday">{weekday}</span>
              {!demo && (
                <Dialog>
                  <DialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon-xs"
                      aria-label="查看统计口径"
                    >
                      <Info />
                    </Button>
                  </DialogTrigger>
                  <DialogContent>
                    <DialogHeader>
                      <DialogTitle>统计口径</DialogTitle>
                      <DialogDescription asChild>
                        <div className="flex flex-col gap-3 leading-relaxed">
                          <p>
                            采集仅统计本机当前账号当天入队的正式任务，不含开发调试。已添加
                            CMS 仅统计实际成功的任务。
                          </p>
                          <p>
                            进行中包括排队和正在处理；需处理包括等待验证、等待登录、失败、中断及提交结果待确认。
                          </p>
                          <p>
                            CMS
                            待审核为当前账号可见的一级、二级、三级待审核总数，不限于今天。三级数据未完整读取时不展示合计。
                          </p>
                        </div>
                      </DialogDescription>
                    </DialogHeader>
                  </DialogContent>
                </Dialog>
              )}
            </div>
            {demo && <Badge variant="outline">演示工作区</Badge>}
          </div>
          <div className="dashboard-actions">
            <Button
              variant="outline"
              disabled={demo || refreshing}
              onClick={refresh}
              aria-label="刷新工作台"
              aria-busy={refreshing}
            >
              <RefreshCw
                data-icon="inline-start"
                className={cn(refreshing && "animate-spin")}
              />
              刷新
            </Button>
            <Button asChild>
              <Link to="/import" onClick={openToday}>
                <Download data-icon="inline-start" />
                导入素材
              </Link>
            </Button>
          </div>
        </header>
        {demo ? (
          <Alert>
            <AlertTitle>演示模式 · Mock 数据</AlertTitle>
            <AlertDescription>
              演示构建不连接真实 CMS，工作台不提供真实业务统计。
            </AlertDescription>
          </Alert>
        ) : (
          <>
            <section
              aria-label="业务概览"
              className="dashboard-overview grid grid-cols-2 gap-3 @min-[960px]/dashboard:grid-cols-4"
            >
              {cards.map(({ id, label, value, scope, detail }) => (
                <Card
                  key={label}
                  size="sm"
                  className="dashboard-stat"
                  data-stat={id}
                  data-attention={id === "attention" && !!value}
                  role="group"
                  aria-label={label}
                >
                  <CardHeader className="dashboard-stat-heading">
                    <CardTitle>{label}</CardTitle>
                    {scope && (
                      <span className="dashboard-stat-scope">{scope}</span>
                    )}
                    {id === "attention" && !!value && (
                      <span className="dashboard-attention-dot" aria-hidden />
                    )}
                  </CardHeader>
                  <CardContent className="dashboard-stat-content">
                    <p className="dashboard-figure">
                      <span>{value ?? "—"}</span>
                      {value !== undefined && value !== null && (
                        <span className="dashboard-unit">
                          {id === "cms" ? "篇" : "条"}
                        </span>
                      )}
                    </p>
                    {label === "CMS 待审核" ? (
                      <div className="dashboard-review-detail">
                        {reviews.map((review, index) => (
                          <Link
                            key={review.view}
                            to={reviewOverviewLink(review.view)}
                            className="underline-offset-4 hover:underline"
                            aria-label={`${["一级", "二级", "三级"][index]}待审核 ${review.data?.total ?? "未读取"} 篇`}
                          >
                            {["一级", "二级", "三级"][index]}{" "}
                            <span>{review.data?.total ?? "—"}</span>
                          </Link>
                        ))}
                      </div>
                    ) : (
                      <p className="dashboard-stat-detail">{detail}</p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </section>
            {dashboard.notificationError && (
              <Alert>
                <AlertTitle>实时状态通知不可用</AlertTitle>
                <AlertDescription>
                  {dashboard.notificationError}
                </AlertDescription>
              </Alert>
            )}
            {harvest.data?.maintenanceWarning && (
              <Alert>
                <AlertTitle>采集记录提示</AlertTitle>
                <AlertDescription>
                  {harvest.data.maintenanceWarning}
                </AlertDescription>
              </Alert>
            )}
            {!!reviewErrors.length && (
              <QueryNotice
                label="CMS 待审核"
                error={reviewErrors.join("；")}
                stale={reviewTotal !== null}
                retry={() =>
                  reviews.forEach((review) => {
                    if (review.error) void review.refetch();
                  })
                }
              />
            )}
            <RecentHarvest
              jobs={stats?.recent ?? []}
              loading={harvest.isPending}
              error={harvest.error?.message ?? null}
              hasData={!!harvest.data}
              onRetry={() => void harvest.refetch()}
              openToday={openToday}
            />
          </>
        )}
        <nav aria-label="工作台快捷入口" className="dashboard-quick-links">
          <span className="dashboard-quick-label">快捷入口</span>
          <Separator
            orientation="vertical"
            className="dashboard-quick-separator"
          />
          <Button variant="ghost" size="sm" asChild>
            <Link to="/import" onClick={openToday}>
              <Download data-icon="inline-start" />
              素材采集
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/articles">
              <FilePenLine data-icon="inline-start" />
              文章管理
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/channels">
              <LayoutList data-icon="inline-start" />
              渠道素材
              <ArrowRight data-icon="inline-end" />
            </Link>
          </Button>
        </nav>
      </div>
    </ScrollArea>
  );
}
