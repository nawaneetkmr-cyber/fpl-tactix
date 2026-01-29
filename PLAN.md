# FPL Tactix — Working Plan (Local)

## Objectives (V1)
- Live Rank Dashboard with real-time polling
- AI Optimized Rank (best decisions from user's squad)
- What-If Simulator (captain change, bench swap, VC toggle)
- Team Visualizer (pitch view with live points)
- Public entry view (read-only)

## Milestones
1) Core API Layer
   - [x] GET /api/fpl/bootstrap → static data proxy
   - [x] GET /api/fpl/entry/:id → summary + season history
   - [x] GET /api/fpl/summary → live dashboard data (auto GW detection)
   - [x] POST /api/fpl/simulate → what-if simulation engine
2) Calculation Engine
   - [x] Live points calculation
   - [x] Best captain finder
   - [x] Bench points & captain points
   - [x] Auto-sub logic (formation validation)
   - [x] AI optimization (best lineup + captain)
   - [x] Rank estimation (normal distribution model)
   - [x] What-if simulations (captain, bench swap, VC)
   - [x] Enriched picks for UI
3) Pages & UI
   - [x] Home page — team ID entry + feature cards
   - [x] /dashboard — tabbed interface with all 4 features
   - [x] /entry/[id] — public entry profile
   - [x] Layout with nav + FPL Tactix branding
   - [x] Design system (CSS variables, cards, badges, buttons)

## Architecture
- Next.js 16 (App Router)
- Tailwind CSS v4
- FPL public API (no auth required)
- 45-second auto-refresh polling on dashboard
- Rank estimation via normal distribution approximation

## Future Scope (Post V1)
- Transfer impact simulator
- Chip optimization (BB, TC, FH)
- Mini league live rank
- AI suggested captain for next GW
- Risk vs safe strategy modes
