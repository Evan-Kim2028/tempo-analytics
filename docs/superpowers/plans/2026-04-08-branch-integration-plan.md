# Tempo Analytics Branch Integration Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Merge the active branch and PR work into `master` with minimal rework, preserve the analytics-first IA changes, carry forward bridge analytics, and refresh the export/payments branch on top of current `master` before merge.

**Architecture:** Treat `master` at `c6ececc` as the integration base. Land the clean analytics IA and bridge UI work in a controlled order, then refresh the older payments/export branch on top of that result. Resolve the shared navigation surface once, then run full regression checks before merging anything.

**Tech Stack:** Git, GitHub PR workflow, Next.js 15, React 19, Jest, npm, local git worktrees

---

### Task 1: Freeze the integration inputs

**Files:**
- Create: `docs/superpowers/plans/2026-04-08-branch-integration-plan.md`
- Review: `src/app/layout.tsx`
- Review: `src/app/page.tsx`
- Review: `src/app/analytics/page.tsx`
- Review: `src/app/api/export/route.ts`
- Review: `src/components/ExportButton.tsx`

- [ ] **Step 1: Record the exact branch and PR set**

Run:

```bash
git -C /home/evan/takopi-adventures/projects/tempo-analytics branch -a --sort=-committerdate
gh pr list --repo Evan-Kim2028/tempo-analytics --state open --limit 20 --json number,title,headRefName,baseRefName,isDraft,url
```

Expected:
- Open PRs are `#3` (`feature/mpp-export`), `#4` (`feature/tempo-analytics-ia-pr`), and `#5` (`bridge-flow-analytics`)
- No separate open PR exists for `feature/dex-pool-explorer-nft-concentration`

- [ ] **Step 2: Verify which local branch no longer needs merging**

Run:

```bash
git -C /home/evan/takopi-adventures/projects/tempo-analytics rev-list --left-right --count master...feature/dex-pool-explorer-nft-concentration
```

Expected:
- Output is `20 0` or equivalent
- Interpretation: `master` is ahead and the branch has no unique commits, so do not spend integration time on it

- [ ] **Step 3: Resolve the missing “hook cleanup” source before merging**

Run:

```bash
git -C /home/evan/takopi-adventures/projects/tempo-analytics branch -a | rg 'hook|cleanup' -i
gh pr list --repo Evan-Kim2028/tempo-analytics --state all --search 'hook cleanup'
```

Expected:
- If a hook-cleanup branch or PR appears, add it to this plan before merge work starts
- If nothing appears, ask the owner which branch/PR/commit carries the hook cleanup changes

### Task 2: Land analytics-first IA before bridge work

**Files:**
- Modify: `src/app/layout.tsx`
- Modify: `src/app/page.tsx`
- Modify: `src/app/analytics/page.tsx`
- Create: `src/components/nav/PrimaryNav.tsx`
- Create: `src/components/analytics/AnalyticsNarrative.tsx`
- Create: `src/components/analytics/TopSponsorsTable.tsx`
- Create: `src/components/charts/FeeTokenMixChart.tsx`
- Create: `src/components/charts/SponsorConcentrationChart.tsx`
- Create: `src/components/charts/TempoFeatureAdoptionChart.tsx`
- Create: `src/components/charts/TempoTxShareChart.tsx`
- Create: `src/components/charts/WebauthnUsageChart.tsx`
- Create: `src/lib/tempoAnalytics.ts`
- Test: `__tests__/components/AnalyticsNarrative.test.tsx`
- Test: `__tests__/components/PrimaryNav.test.tsx`
- Test: `__tests__/lib/tempoAnalytics.test.ts`

- [ ] **Step 1: Create an integration worktree from current `master`**

Run:

```bash
git -C /home/evan/takopi-adventures/projects/tempo-analytics fetch origin
git -C /home/evan/takopi-adventures/projects/tempo-analytics worktree add /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/integration-master -b integration/master origin/master
```

Expected:
- New worktree at `.worktrees/integration-master`
- Branch `integration/master` tracks the latest `origin/master`

- [ ] **Step 2: Merge or cherry-pick PR `#4` into the integration branch**

Run:

```bash
git -C /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/integration-master fetch origin feature/tempo-analytics-ia-pr
git -C /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/integration-master merge --no-ff origin/feature/tempo-analytics-ia-pr
```

Expected:
- Merge completes cleanly
- `src/app/layout.tsx` now uses `PrimaryNav`
- `src/app/page.tsx` redirects or reframes the landing experience around analytics

- [ ] **Step 3: Run the PR `#4` targeted validation before stacking anything else**

Run:

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/integration-master
npm test -- --runInBand __tests__/lib/tempoAnalytics.test.ts __tests__/components/AnalyticsNarrative.test.tsx __tests__/components/PrimaryNav.test.tsx
npm run build
```

Expected:
- Targeted analytics IA tests pass
- Production build succeeds

### Task 3: Stack bridge analytics on top of the analytics-first nav shell

**Files:**
- Modify: `src/app/layout.tsx`
- Modify: `src/components/nav/PrimaryNav.tsx`
- Create: `src/app/bridges/page.tsx`
- Create: `src/components/BridgeFlowTable.tsx`
- Create: `src/lib/bridge-registry.ts`
- Create: `src/lib/bridge-verification.ts`
- Create: `src/lib/bridges.ts`
- Test: `__tests__/components/BridgeFlowTable.test.tsx`
- Test: `__tests__/lib/bridge-registry.test.ts`
- Test: `__tests__/lib/bridge-verification.test.ts`
- Test: `__tests__/lib/bridges.test.ts`

- [ ] **Step 1: Merge PR `#5` into the integration branch**

Run:

```bash
git -C /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/integration-master fetch origin bridge-flow-analytics
git -C /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/integration-master merge --no-ff origin/bridge-flow-analytics
```

Expected:
- One intentional conflict in navigation or `layout.tsx`
- All bridge-specific files add cleanly

- [ ] **Step 2: Resolve the nav conflict by preserving the PR `#4` shell and porting the bridge link into it**

Target state:

```tsx
import { PrimaryNav } from '@/components/nav/PrimaryNav'
```

and `PrimaryNav` contains the bridge route alongside the analytics-first tabs.

Expected:
- Keep the `PrimaryNav` abstraction from PR `#4`
- Do not revert to hard-coded nav links in `layout.tsx`
- Add `/bridges` as a first-class tab in the shared nav component

- [ ] **Step 3: Run the bridge-targeted validation after conflict resolution**

Run:

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/integration-master
npm test -- --runInBand __tests__/components/BridgeFlowTable.test.tsx __tests__/lib/bridge-registry.test.ts __tests__/lib/bridge-verification.test.ts __tests__/lib/bridges.test.ts
npm run build
```

Expected:
- Bridge tests pass on top of the analytics-first shell
- `/bridges` is reachable from the unified nav

### Task 4: Rebase or merge-refresh the payments/export PR last

**Files:**
- Modify: `.env.example`
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `jest.config.ts`
- Modify: `src/app/api/export/route.ts`
- Modify: `src/components/ExportButton.tsx`
- Delete: `src/lib/mpp.ts`
- Test: `__tests__/api/export.test.ts`
- Test: `__tests__/lib/mpp.test.ts`

- [ ] **Step 1: Refresh PR `#3` onto the integrated branch instead of merging its stale head directly**

Run:

```bash
git -C /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/mpp-export fetch origin
git -C /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/mpp-export rebase integration/master
```

Fallback if rebase is noisy:

```bash
git -C /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/mpp-export merge --no-ff integration/master
```

Expected:
- Export/payments changes are replayed on top of the already-integrated analytics + bridge state
- Any package or test conflicts are resolved in the export branch rather than in `master`

- [ ] **Step 2: Verify the modern payment contract still matches the UI and API**

Run:

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/mpp-export
npm test -- --runInBand __tests__/api/export.test.ts
npm run build
```

Expected:
- Export route tests pass after the rebase
- Build succeeds with `mppx` dependencies installed

- [ ] **Step 3: Replace PR `#3` with a refreshed branch before merging**

Run:

```bash
git -C /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/mpp-export push --force-with-lease origin HEAD:feature/mpp-export
```

Expected:
- PR `#3` now reflects current `master` plus the export/payment migration only
- The PR diff remains limited to the export/payment surface

### Task 5: Run final full-repo verification on the combined branch

**Files:**
- Review: `package.json`
- Review: `jest.config.ts`
- Review: `src/app/layout.tsx`
- Review: `src/components/nav/PrimaryNav.tsx`
- Review: `src/app/bridges/page.tsx`
- Review: `src/app/api/export/route.ts`

- [ ] **Step 1: Execute the full regression suite from the final integration branch**

Run:

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/integration-master
npm test -- --runInBand
npm run build
```

Expected:
- Full Jest suite passes
- Next.js build passes

- [ ] **Step 2: Smoke-check the merged UX surfaces locally**

Run:

```bash
cd /home/evan/takopi-adventures/projects/tempo-analytics/.worktrees/integration-master
npm run dev
```

Check:
- `/` lands in the analytics-first experience
- `/analytics` renders the narrative/overview content
- `/bridges` renders and is reachable from the primary nav
- `/dex`, `/stablecoins`, and `/nfts` still render
- Export flow still returns `402` challenge behavior and the button UI still handles payment methods correctly

- [ ] **Step 3: Merge in this order**

Order:

```text
1. PR #4 (analytics-first IA)
2. PR #5 (bridge analytics) with nav conflict resolved into PrimaryNav
3. PR #3 (refreshed export/payments branch)
```

Expected:
- Lowest-risk nav conflict resolved once
- Oldest/outdated branch lands last after refresh
- `master` ends with one coherent navigation model and current export flow

## Self-Review

- Spec coverage: covers all open PRs plus the already-landed DEX/NFT work on `master`; explicitly blocks on identifying the missing hook-cleanup branch if it exists outside the known PR set
- Placeholder scan: no `TODO` or deferred merge steps without commands
- Type consistency: all referenced branches, PRs, and files match current repo state as of `2026-04-08`
