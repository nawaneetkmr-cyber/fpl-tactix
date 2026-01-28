# FPL Tactix — Working Plan (Local)

## Objectives (V1)
- Public entry view (read-only): rank bands, last-GW what‑if, history
- Simple projections helper
- Transfer suggester (single GW) scaffold

## Milestones
1) API (public)
   - [ ] GET /api/fpl/entry/:id → summary + season history
   - [ ] GET /api/fpl/entry/:id/event/:gw → GW points
2) UI
   - [ ] /entry/[id] page → header (team name, OR, total pts)
   - [ ] Last‑GW card (points; what‑if placeholder)
   - [ ] Rank-band card scaffold
3) Helpers
   - [ ] Projections helper (baseline)

## Notes
- Data: official FPL public endpoints only for public mode
- Cookie-based picks later (optional)
