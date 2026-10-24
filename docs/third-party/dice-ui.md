# Dice UI Data Table

采用 Dice UI 官方 Radix Data Table / Nova 源码，按 PressDock 的查询、滚动和列配置需求适配。

- 上游：[sadmann7/diceui](https://github.com/sadmann7/diceui)
- 参考提交：`061d7b67ef233c531f2c86448741f0b37b3d3583`（2026-10-24 核对）
- [Data Table 源码](https://github.com/sadmann7/diceui/blob/061d7b67ef233c531f2c86448741f0b37b3d3583/docs/registry/bases/radix/components/data-table/data-table.tsx)
- [列宽与固定列工具](https://github.com/sadmann7/diceui/blob/061d7b67ef233c531f2c86448741f0b37b3d3583/docs/lib/data-table-utils.ts)

本地适配位于 `src/components/ui/data-table.tsx`、`src/lib/data-table.ts`：保留类型化表格渲染、订阅和固定列能力；查询及分页由业务层控制，移除 Next.js、nuqs、高级筛选和多选操作栏。列配置复用项目现有 Radix 菜单，列宽调整支持指针与键盘。底层使用 npm 固定安装的 `@tanstack/react-table@9.3.1`（MIT），不使用 v8 API。

以下为 Dice UI 原始许可证全文。

```text
MIT License

Copyright (c) 2024 Sadman Sakib

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
