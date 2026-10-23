import {
  LayoutDashboard,
  Download,
  Files,
  SquarePen,
  Images,
  Send,
  Settings,
  Library,
} from "lucide-react";
export const navigation = [
  { to: "/dashboard", label: "工作台", icon: LayoutDashboard },
  { to: "/channels", label: "渠道素材管理", icon: Library },
  { to: "/import", label: "素材导入", icon: Download },
  { to: "/articles", label: "文章管理", icon: Files },
  { to: "/editor/demo-1", label: "内容编辑", icon: SquarePen },
  { to: "/images", label: "图片处理", icon: Images },
  { to: "/publish", label: "发布管理", icon: Send },
  { to: "/settings", label: "系统设置", icon: Settings },
];
