---
name: Express 5 params type
description: req.params[key] is typed as string | string[] in Express 5 TypeScript types; parseInt needs a string.
---

## Rule
Always wrap `req.params.id` (or any param) with `String()` before passing to `parseInt`:

```typescript
const id = parseInt(String(req.params.id));
```

**Why:** Express 5 TypeScript types declare `ParamsDictionary[key]` as `string | string[]`. Passing it directly to `parseInt()` causes TS2345. The runtime value is always a string, but the type must be narrowed.

**How to apply:** Grep for `parseInt(req.params` and replace with `parseInt(String(req.params`.
