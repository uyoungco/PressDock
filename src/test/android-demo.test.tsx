import { afterEach, expect, it, vi } from "vitest";
import {
  fireEvent,
  render,
  screen,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import Login from "@/pages/Login";
import { StatusBar } from "@/components/layout/StatusBar";

const login = vi.hoisted(() => vi.fn().mockResolvedValue({ persistent: true }));
vi.mock("@/hooks/use-auth", () => ({
  useAuth: () => ({ status: "anonymous", session: null, error: null }),
}));
vi.mock("@/features/auth/service", () => ({
  authService: { login },
  safeReturnPath: () => "/channels",
}));
vi.mock("@/services/tauri/client", () => ({ isDesktop: () => true }));
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

it("演示入口不索取真实凭据，只进入固定的本机账号", async () => {
  vi.stubEnv("VITE_PRESSDOCK_DEMO", "1");
  render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>,
  );
  expect(
    screen.getByRole("heading", { name: "PressDock 演示版" }),
  ).toBeInTheDocument();
  expect(screen.queryByLabelText("用户名")).not.toBeInTheDocument();
  expect(screen.queryByLabelText("密码")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "进入演示工作区" }));
  await waitFor(() =>
    expect(login).toHaveBeenCalledWith({ username: "demo", password: "demo" }),
  );
});

it("演示标识与正式登录入口由构建开关隔离", () => {
  vi.stubEnv("VITE_PRESSDOCK_DEMO", "0");
  render(
    <MemoryRouter>
      <Login />
    </MemoryRouter>,
  );
  expect(screen.getByLabelText("用户名")).toBeInTheDocument();
  expect(
    screen.queryByRole("button", { name: "进入演示工作区" }),
  ).not.toBeInTheDocument();
  cleanup();
  vi.stubEnv("VITE_PRESSDOCK_DEMO", "1");
  render(<StatusBar />);
  expect(screen.getByText("演示工作区 · 本机 Mock 数据")).toBeInTheDocument();
});
