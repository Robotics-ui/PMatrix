---
name: Theme system
description: How dark/light mode is implemented — ThemeProvider, CSS variables, portal inheritance, no inline dark classes.
---

## Rule
The ThemeProvider (`artifacts/pesamatrix/src/contexts/theme-context.tsx`) is the single source of truth for dark/light/system theme. It applies the `.dark` class to `document.documentElement` (`<html>`).

**Never** add `className="dark ..."` to individual page wrappers, dialog contents, or any component. This was the old pattern and will break light mode.

**Why:** Tailwind v4 uses `@custom-variant dark (&:is(.dark *))` — dark styles apply to all elements that are descendants of a `.dark` ancestor. Since `.dark` is on `<html>`, every element in the page (including Radix UI dialog portals rendered at `<body>` level) inherits dark mode correctly.

**How to apply:**
- Dialog portals: remove `dark` from `DialogContent className="dark bg-card ..."` → `DialogContent className="bg-card ..."`
- Standalone auth pages (login, register, forgot-password): remove `dark` from outer div
- ThemeProvider is in App.tsx, wrapping Router, inside AuthProvider (so it can receive the auth token for API sync)

## Theme persistence
1. localStorage (`pesamatrix-theme`) — applied immediately on mount
2. User DB field (`users.theme`) — synced via PATCH /users/me/theme on change
3. Admin default — served via GET /platform-theme (public), used when no localStorage preference

## Admin default theme
Stored in `adminSettingsTable.defaultTheme` (text, default "dark"). Updated via PATCH /admin/settings with `{"defaultTheme": "light"|"dark"|"system"}` in request body (accepted directly from req.body, not part of the Zod schema).
