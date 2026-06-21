---
name: Custom API calls in frontend
description: How to make API calls in the frontend for endpoints not covered by generated React Query hooks.
---

## Rule
`@workspace/api-client-react` does NOT export `axiosInstance`. Use native `fetch` with the auth token from `useAuth()`:

```typescript
import { useAuth } from "@/hooks/use-auth";

const { token } = useAuth();

const data = await fetch("/api/some-endpoint", {
  headers: { Authorization: `Bearer ${token}` },
}).then((r) => r.json());
```

**Why:** The package only exports generated Orval hooks, `setBaseUrl`, and `setAuthTokenGetter`. There is no axios instance exposed.

**How to apply:** For custom `useQuery` calls hitting non-generated endpoints, write a local `apiFetch` helper that accepts the token and calls `fetch`. See `artifacts/pesamatrix/src/pages/referrals.tsx` for the pattern.
