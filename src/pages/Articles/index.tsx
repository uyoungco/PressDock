import { useState } from "react";
import { useAtom } from "jotai";
import { Link } from "react-router-dom";
import { Plus, Search } from "lucide-react";
import { PageHeader } from "@/components/common/PageHeader";
import { ArticleTable } from "@/components/common/ArticleTable";
import { LoadState } from "@/components/common/LoadState";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { globalSearchAtom } from "@/atoms/app";
import { STATUS_LABELS } from "@/constants/app";
import { useArticles } from "@/hooks/use-articles";

export default function Articles() {
  const { articles, loading, error } = useArticles();
  const [search, setSearch] = useAtom(globalSearchAtom);
  const [status, setStatus] = useState("all");
  const filtered = articles.filter(
    (a) =>
      a.title.toLocaleLowerCase().includes(search.toLocaleLowerCase()) &&
      (status === "all" || a.status === status),
  );
  return (
    <>
      <PageHeader
        title="文章管理"
        description="管理素材与稿件，跟进每篇文章的编辑状态。"
        action={
          <Button asChild>
            <Link to="/import">
              <Plus className="size-4" />
              导入文章
            </Link>
          </Button>
        }
      />
      <Card className="gap-0 overflow-hidden py-0 shadow-none">
        <div className="flex flex-wrap items-center gap-3 border-b p-4">
          <div className="relative w-full sm:w-72">
            <Search className="absolute top-2.5 left-3 size-4 text-muted-foreground" />
            <Input
              aria-label="筛选文章标题"
              placeholder="按标题搜索…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={status} onValueChange={setStatus}>
            <SelectTrigger aria-label="筛选文章状态" className="w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部状态</SelectItem>
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <span className="ml-auto text-xs text-muted-foreground">
            共 {filtered.length} 篇
          </span>
        </div>
        <LoadState loading={loading} error={error} />
        {!loading && !error && <ArticleTable articles={filtered} />}
      </Card>
    </>
  );
}
