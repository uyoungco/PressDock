import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it } from "vitest";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

it("垂直 Tabs 将方向传给 Radix，并通过上下方向键切换面板", async () => {
  const user = userEvent.setup();
  render(
    <Tabs defaultValue="first" orientation="vertical">
      <TabsList aria-label="垂直模块">
        <TabsTrigger value="first">第一个模块</TabsTrigger>
        <TabsTrigger value="second">第二个模块</TabsTrigger>
      </TabsList>
      <TabsContent value="first">第一个面板</TabsContent>
      <TabsContent value="second">第二个面板</TabsContent>
    </Tabs>,
  );
  expect(screen.getByRole("tablist")).toHaveAttribute(
    "aria-orientation",
    "vertical",
  );
  await user.click(screen.getByRole("tab", { name: "第一个模块" }));
  await user.keyboard("{ArrowDown}");
  expect(screen.getByRole("tab", { name: "第二个模块" })).toHaveFocus();
  expect(screen.getByRole("tab", { name: "第二个模块" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  expect(
    screen.getByRole("tabpanel", { name: "第二个模块" }),
  ).toHaveTextContent("第二个面板");
  expect(screen.queryByText("第一个面板")).not.toBeInTheDocument();
  await user.keyboard("{ArrowUp}");
  expect(screen.getByRole("tabpanel", { name: "第一个模块" })).toBeVisible();
});
