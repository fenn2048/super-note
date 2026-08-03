import React from "react";
import { useTheme } from "next-themes";
import { motion } from "framer-motion";
import { Sun, Moon } from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { springs } from "@/lib/motion";

/** Light / dark only (system option removed). */
export default function ThemeToggle() {
  const { t } = useTranslation();
  const { theme, setTheme, resolvedTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  const themes = [
    { key: "light" as const, icon: Sun, label: t("theme.light") },
    { key: "dark" as const, icon: Moon, label: t("theme.dark") },
  ];

  React.useEffect(() => setMounted(true), []);

  // Collapse legacy "system" to resolved light/dark once
  React.useEffect(() => {
    if (!mounted) return;
    if (theme === "system" && resolvedTheme) {
      setTheme(resolvedTheme);
    }
  }, [mounted, theme, resolvedTheme, setTheme]);

  if (!mounted) return null;

  const active = theme === "dark" || theme === "light" ? theme : resolvedTheme || "light";

  return (
    <div
      role="group"
      aria-label={t("theme.toggle", { defaultValue: "Theme toggle" })}
      className="flex items-center gap-1 p-1 rounded-lg bg-app-hover"
    >
      {themes.map(({ key, icon: Icon, label }) => (
        <button
          key={key}
          type="button"
          onClick={() => setTheme(key)}
          title={label}
          aria-label={label}
          aria-pressed={active === key}
          className={cn(
            "relative p-1.5 rounded-md transition-colors duration-press ease-out min-h-[36px] min-w-[36px] inline-flex items-center justify-center",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-primary focus-visible:ring-offset-1 focus-visible:ring-offset-app-bg",
            active === key
              ? "text-accent-primary"
              : "text-tx-tertiary hover:text-tx-secondary",
          )}
        >
          {active === key && (
            <motion.div
              layoutId="theme-indicator"
              className="absolute inset-0 rounded-md bg-app-active"
              transition={springs.snappy}
            />
          )}
          <Icon size={14} className="relative z-10" />
        </button>
      ))}
    </div>
  );
}
