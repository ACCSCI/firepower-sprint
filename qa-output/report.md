# Dogfood Report: 火力冲刺

| Field | Value |
|-------|-------|
| Date | 2026-09-01 |
| App URL | http://127.0.0.1:43999 |
| Session | adgames-qa |
| Scope | 430×932 mobile portrait; start flow, early combat, chapter pacing, car direction, console |

## Summary

| Severity | Count |
|----------|-------|
| Critical | 0 |
| High | 0 |
| Medium | 0 |
| Low | 0 |
| Total | 0 |

## Notes

Validation run after pacing revision.

- First pass reproduced an overly punishing transition: an idle player could reach the car chapter with zero health after stacked enemy/barrier collisions.
- Enemy count was reduced again, normal collision damage was lowered, and the run was repeated from a fresh reload.
- Second pass reached the car chapter with 44 health without steering; the HUD reported `矿洞战车 · 战车 · 火力向前`, and the car model faced forward.
- No page errors or failed runtime model requests were observed. The only console entries were Vite development connection messages.
- Evidence: `screenshots/revised-start.png`, `screenshots/revised-early-2.png`, `screenshots/revised-car-survival.png`.

## Multi-level and health-bar validation

| Field | Value |
|-------|-------|
| Session | `adgames-multilevel` |
| Scope | 430×932 mobile portrait; four-level selector; cloud, ocean, hell, surface; attackable health bars |

- The start screen exposes all four unlocked levels in a 2×2 touch-friendly picker and remembers the selected level.
- Level 1 loaded the surface route, level 2 loaded the elevated plane/cloud route, level 3 loaded the submarine/ocean route, and level 4 loaded the on-foot hell route.
- Enemy health bars and destructible-obstacle health bars were visible in every inspected environment. Bars billboard toward the camera and remain aligned at plane/submarine altitude.
- Four read-only five-second simulation runs remained active: L1 HP 84, L2 HP 72, L3 HP 80, L4 HP 100. The earlier apparent cloud-level instant death was an automation wait error, not a game defect.
- No browser page errors were reported. Production build passed and all 27 simulation tests passed.
- Evidence: `screenshots/multilevel-select.png`, `screenshots/multilevel-wasteland.png`, `screenshots/multilevel-cloud.png`, `screenshots/multilevel-ocean.png`, `screenshots/multilevel-hell.png`.

## Forward-only combat and minecart expedition validation

| Field | Value |
|-------|-------|
| Date | 2026-09-02 |
| Session | `adgames-minecart` |
| Scope | Forward-only combat cleanup; fifth level selector card; minecart environment at 430×932 and 360×740 |

- The fifth selectable level, `幽晶矿车`, is visible and usable at both inspected mobile sizes. The odd final card expands across the two-column picker without clipping.
- The level starts directly in a dedicated minecart and the HUD reports `废弃矿井 · 矿车 · 火力向前`.
- Rails, sleepers, timber supports, hanging mine lamps and crystal formations are visible in the opening gameplay frame.
- Source and regression checks found no remaining rear-combat state or runtime branch. Forward targeting ignores enemies that have already passed behind the player.
- No browser page errors were reported. WCAG A/AA automated audit reported 0 violations and 0 incomplete checks.
- Production build passed and all 27 simulation tests passed.
- Evidence: `screenshots/minecart-level-select.png`, `screenshots/minecart-level-select-compact.png`, `screenshots/minecart-expedition.png`.

## Curved routes, vehicle weapons and bomb feedback validation

| Field | Value |
|-------|-------|
| Date | 2026-09-02 |
| Session | `adgames-curves` |
| Scope | Five curved/elevated routes; ground-to-cloud takeoff; submarine heading; mounted weapons; bomb event and VFX |

- All five route profiles now include measurable horizontal curvature and vertical elevation changes; the simulation remains in straight progress/lane coordinates while rendering maps onto the 3D path.
- The cloud campaign begins on a green surface runway, climbs into the cloud segment, and follows a visible S-curve.
- The submarine's four rear thrusters are visible at the camera-facing end and its bow points toward upcoming targets.
- Vehicle mounts remain visible over loaded GLB bodies. A real level run confirmed the car changed from its base cannon to a bright twin-barrel mount after collecting `双联炮管`, and later to the rotating gatling configuration.
- Bomb pickups emit a dedicated aggregate event, low-frequency synthesized blast, large expanding shockwave, 54-particle burst, camera shake, and hit/destroy counts. Regression coverage verifies two nearby attackable targets are hit and destroyed.
- Every level is 150% of its previous length with 15 regular enemies, one boss, nine obstacles, eight pickups and 9–10 gate pairs.
- No browser page errors were reported. Production build passed and all 30 tests passed.
- Evidence: `screenshots/submarine-forward-curved.png`, `screenshots/plane-ground-takeoff.png`, `screenshots/plane-ground-s-curve.png`, `screenshots/car-twin-cannon-curved.png`, `screenshots/car-twin-cannon-center.png`.
