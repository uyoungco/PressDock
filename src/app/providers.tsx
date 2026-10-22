import { Provider } from "jotai";
import type { PropsWithChildren } from "react";
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
export function AppProviders({ children }: PropsWithChildren) {
  return (
    <Provider>
      <ThemeProvider>{children}</ThemeProvider>
    </Provider>
  );
}
