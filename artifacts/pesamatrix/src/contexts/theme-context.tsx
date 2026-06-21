import React, { createContext, useCallback, useContext, useEffect, useState } from "react";

export type Theme = "dark" | "light" | "system";
export type ResolvedTheme = "dark" | "light";

interface ThemeContextType {
  theme: Theme;
  resolvedTheme: ResolvedTheme;
  setTheme: (theme: Theme) => void;
}

const ThemeContext = createContext<ThemeContextType>({
  theme: "dark",
  resolvedTheme: "dark",
  setTheme: () => {},
});

const STORAGE_KEY = "pesamatrix-theme";

function getSystemTheme(): ResolvedTheme {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function resolveTheme(theme: Theme): ResolvedTheme {
  if (theme === "system") return getSystemTheme();
  return theme;
}

function applyTheme(resolved: ResolvedTheme) {
  const root = document.documentElement;
  if (resolved === "dark") {
    root.classList.add("dark");
  } else {
    root.classList.remove("dark");
  }
  root.style.colorScheme = resolved;
}

interface ThemeProviderProps {
  children: React.ReactNode;
  token?: string | null;
}

export function ThemeProvider({ children, token }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as Theme | null;
    if (saved && ["dark", "light", "system"].includes(saved)) return saved;
    return "dark";
  });

  const resolvedTheme: ResolvedTheme = resolveTheme(theme);

  useEffect(() => {
    applyTheme(resolvedTheme);
  }, [resolvedTheme]);

  // Listen for system preference changes when theme === "system"
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => applyTheme(mq.matches ? "dark" : "light");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, [theme]);

  // Fetch user theme preference from API when token is available
  useEffect(() => {
    if (!token) return;
    fetch("/api/users/me", {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.json())
      .then((data: { theme?: string }) => {
        const savedLocal = localStorage.getItem(STORAGE_KEY);
        // Only sync from DB if no local preference set
        if (!savedLocal && data.theme && ["dark", "light", "system"].includes(data.theme)) {
          const t = data.theme as Theme;
          setThemeState(t);
          localStorage.setItem(STORAGE_KEY, t);
        }
      })
      .catch(() => {});
  }, [token]);

  // Fetch admin default theme for unauthenticated visitors
  useEffect(() => {
    if (token) return;
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) return;
    fetch("/api/platform-theme")
      .then((r) => r.json())
      .then((data: { defaultTheme?: string }) => {
        const t = (data.defaultTheme ?? "dark") as Theme;
        setThemeState(t);
        localStorage.setItem(STORAGE_KEY, t);
      })
      .catch(() => {});
  }, [token]);

  const setTheme = useCallback(
    (newTheme: Theme) => {
      setThemeState(newTheme);
      localStorage.setItem(STORAGE_KEY, newTheme);
      if (token) {
        fetch("/api/users/me/theme", {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({ theme: newTheme }),
        }).catch(() => {});
      }
    },
    [token],
  );

  return (
    <ThemeContext.Provider value={{ theme, resolvedTheme, setTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useThemeContext() {
  return useContext(ThemeContext);
}
