import {
  LayoutDashboard,
  Download,
  Files,
  Images,
  Send,
  Settings,
  Library,
} from "lucide-react";
type NavigationItem = {
  to: string;
  label: string;
  icon: typeof Files;
  children?: { to: string; label: string }[];
};
export const navigation: NavigationItem[] = [
  { to: "/dashboard", label: "工作台", icon: LayoutDashboard },
  { to: "/channels", label: "渠道素材管理", icon: Library },
  { to: "/import", label: "素材导入", icon: Download },
  {
    to: "/articles",
    label: "文章管理",
    icon: Files,
    children: [
      { to: "/articles/quality", label: "优质文章" },
      { to: "/articles/review-1", label: "一级待审核文章" },
      { to: "/articles/review-2", label: "二级待审核文章" },
      { to: "/articles/review-3", label: "三级待审核文章" },
    ],
  },
  { to: "/images", label: "图片处理", icon: Images },
  { to: "/publish", label: "发布管理", icon: Send },
  { to: "/settings", label: "系统设置", icon: Settings },
];
