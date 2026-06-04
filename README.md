# Office Lighting Control — MVP

Interactive prototype of a **self-service, context-aware office lighting control dashboard**, built as part of an Operations Analyst test task.

**▶ Live demo:** https://reshetnyk-o.github.io/office-lighting-mvp/

## What it demonstrates

- **Schedule editor** — ON/OFF times and active days, applied with no developer and no deployment
- **Holiday / exception dates** — skip a day or set custom hours
- **Manual override** — Force ON/OFF with auto-expiring duration
- **Energy settings** — occupancy auto-off and daylight threshold
- **Activity log** — every change, switch, override, and failure, with user + timestamp
- **Role-based access** — Editor vs View-only toggle
- **Live decision trace** — shows which rule in the priority chain made the current decision
- **Live simulation panel** — adjust date, time, occupancy, and ambient light to watch the rules engine react

## Notes

- Plain HTML/CSS/JS — no build step, no dependencies. Open `index.html` or the live demo.
- **Demo simulation only** — not connected to real hardware. In production the engine reads sensors and a clock; here you drive them from the simulation panel.
- State persists in `localStorage`.
