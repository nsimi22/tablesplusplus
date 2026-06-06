import { Moon, Sun } from "lucide-react";
import { Button } from "./Button";
import { useThemeStore } from "@/store/useThemeStore";

/** Toggle between the dark (default) and light themes. */
export function ThemeToggle() {
  const theme = useThemeStore((s) => s.theme);
  const toggleTheme = useThemeStore((s) => s.toggleTheme);
  const dark = theme === "dark";
  return (
    <Button
      size="icon"
      variant="ghost"
      onClick={toggleTheme}
      aria-label={dark ? "Switch to light mode" : "Switch to dark mode"}
      title={dark ? "Light mode" : "Dark mode"}
    >
      {dark ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </Button>
  );
}
