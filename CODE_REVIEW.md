# Code Review Findings

Date: 2026-02-13

This review was performed with static inspection and `npm run lint`.

## High severity

1. **Ref mutation/read during render in `FixtureDifficultyGrid`**
   - File: `src/components/FixtureDifficultyGrid.tsx`
   - Problem: `prevIdsRef.current` is both read and written inside a `useMemo` during render. This violates React's ref usage model and can produce stale behavior under concurrent rendering.
   - Evidence: lines 29-36.
   - Recommendation: remove the ref-based stabilization logic and instead memoize a sorted key from `highlightTeamIds` or normalize upstream with stable references.

2. **Unsafe non-null assertion after optional chaining in dashboard bench swap label**
   - File: `src/app/dashboard/page.tsx`
   - Problem: expression `getPlannerSquad().find(... )?.position!` can still be `undefined` at runtime if no player matches the selected slot. The non-null assertion only silences TypeScript and can crash rendering.
   - Evidence: line 1612.
   - Recommendation: store the selected player once, guard for `undefined`, and render fallback text.

## Medium severity

3. **Synchronous state updates from effect path in analytics page**
   - File: `src/app/analytics/page.tsx`
   - Problem: `useEffect(() => { fetchData(); }, [fetchData])` triggers a callback that immediately sets state (`setLoading`, `setError`) and then asynchronous state updates. Lint rule flags this as a cascading-render pattern risk.
   - Evidence: lines 35-49.
   - Recommendation: inline the async effect body, add cancellation with `AbortController`, and avoid stale updates when tab or `teamId` changes quickly.

4. **Client-side navigation uses raw `<a>` elements in app layout**
   - File: `src/app/layout.tsx`
   - Problem: internal routes (`/`, `/dashboard`, `/analytics`) use `<a href>` instead of `next/link`.
   - Impact: full page reloads, lost client state, and slower transitions.
   - Evidence: lines 30-76.
   - Recommendation: replace with `Link` from `next/link`.

## Low severity / hygiene

5. **Unused variables across API/lib files**
   - Examples:
     - `src/app/api/fpl/summary/route.ts` (`gwEvent`, `primaryProjMap`)
     - `src/lib/advisor.ts` (`form`)
     - `src/lib/calculations.ts` (`fixtures`)
     - `src/lib/solver.ts` (`currentSquadIds`)
     - `src/lib/strategy.ts` (`_allElements`)
   - Recommendation: remove dead assignments/parameters or prefix intentionally unused parameters consistently.

6. **`prefer-const` violation in dashboard page**
   - File: `src/app/dashboard/page.tsx`
   - Problem: one `let` variable is never reassigned.
   - Recommendation: use `const` to clarify immutability and reduce accidental mutation.

## Checks run

- `npm run lint` (failed: 6 errors, 7 warnings)
