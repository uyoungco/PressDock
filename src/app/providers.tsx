import { Provider } from "jotai";
import { useEffect, type PropsWithChildren } from "react";
import { QueryClientProvider } from "@tanstack/react-query";
import {
  appQueryRuntime,
  registerQueryRuntime,
  type QueryRuntime,
} from "@/lib/query-runtime";
import { HarvestQueryEvents } from "@/features/import/query-events";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { useTheme } from "@/hooks/use-theme";

function ThemeProvider({ children }: PropsWithChildren) {
  const theme = useTheme();
  return (
    <TooltipProvider>
      {children}
      <Toaster theme={theme} richColors closeButton />
    </TooltipProvider>
  );
}
export function AppProviders({
  children,
  runtime = appQueryRuntime,
}: PropsWithChildren<{ runtime?: QueryRuntime }>) {
  useEffect(() => registerQueryRuntime(runtime), [runtime]);
  return (
    <QueryClientProvider client={runtime.client}>
      <Provider store={runtime.store}>
        <HarvestQueryEvents />
        <ThemeProvider>{children}</ThemeProvider>
      </Provider>
    </QueryClientProvider>
  );
}
