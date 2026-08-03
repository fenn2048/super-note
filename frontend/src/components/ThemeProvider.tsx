import { ThemeProvider as NextThemesProvider } from "next-themes";
import React from "react";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      // 仅 light / dark（已去掉 system 与多皮肤）
      defaultTheme="light"
      enableSystem={false}
      disableTransitionOnChange={false}
      storageKey="super-note-theme"
    >
      {children}
    </NextThemesProvider>
  );
}
