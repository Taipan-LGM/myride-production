# My Ride — Unified Design System v3.0

## Color Palette (Bold · Trust · Speed)

| Token | Hex | Usage |
|-------|-----|--------|
| **Midnight Navy** | `#0A2540` | Shell, headers, map dark mode, admin sidebar |
| **Navy Mid** | `#0F3152` | Gradients, panels, depth layers |
| **Electric Mint** | `#00D4AA` | Primary CTA, online status, success, route accent |
| **Cyan Glow** | `#00E5C8` | Route lines, chart highlights, hover glow |
| **Coral Burst** | `#FF6B35` | SOS, surge, trip request urgency, alerts |
| **Surface** | `#F6F9FC` | Admin main canvas, rider light sheets |
| **Card** | `#FFFFFF` | Cards, bottom sheets |
| **Text Primary** | `#1A1A1A` | Body on light surfaces |
| **Text Secondary** | `#5A6B82` | Captions, metadata |

**Gradients**
- CTA: `linear-gradient(135deg, #00D4AA 0%, #00E5C8 100%)`
- Hero: `linear-gradient(160deg, #0A2540 0%, #0F3152 50%, #0A2540 100%)`
- Map night: `linear-gradient(180deg, #061828 0%, #0A2540 100%)`

## Typography (Speed + Trust)

| Role | Family | Weight | Size | Tracking |
|------|--------|--------|------|----------|
| Display / ETA | Roboto Mono | 700–800 | 32–42px | -0.5px |
| H1 / Screen title | Inter | 700–800 | 24–32px | -0.5px |
| Body | Inter | 400–500 | 14–16px | 0 |
| Label / Nav | Inter | 600–700 | 11–13px | +0.08em caps |
| Fare / KPI | Roboto Mono | 700–800 | 16–28px | 0 |

## Movement & Animation Style Guide

### Easing curves
| Name | Value | Use |
|------|-------|-----|
| **Spring** | `cubic-bezier(0.34, 1.56, 0.64, 1)` | Buttons, sheet entry, accept trip |
| **Standard** | `cubic-bezier(0.4, 0, 0.2, 1)` | Fades, theme transitions |
| **Decel** | `cubic-bezier(0, 0, 0.2, 1)` | Slide-up panels, chart bars |
| **Linear loop** | `linear` | Route draw, car motion along path |

### Durations
| Duration | Element |
|----------|---------|
| **120ms** | Tap scale (0.96), icon press |
| **200ms** | Toggle switch, chip select |
| **400–600ms** | Bottom sheet slide-up, card entry |
| **2–3s** | Breathe glow on primary CTA (infinite) |
| **3–8s** | Route line draw, progress bar fill |
| **6s** | Vehicle icon `animateMotion` along route |
| **2.2s** | Driver earnings tick interval |

### Interaction states
- **Hover (web/admin):** `translateY(-2px)` + glow `0 0 24px rgba(0,212,170,0.35)`
- **Active/press:** `scale(0.96)`, glow reduces 40%
- **Focus:** 2px `#00D4AA` outline, 4px offset
- **Live badge:** 8px dot, `live-dot` 1.2s pulse

### Reduced motion
`@media (prefers-reduced-motion: reduce)` — disable infinite loops; keep single state transitions ≤200ms.

---

## App 1 — Rider (Mobile) Motion Table

| Element | Motion | Duration | Trigger | Easing |
|---------|--------|----------|---------|--------|
| Map route line | `stroke-dashoffset` 200→0 loop | 3s | Page load | linear |
| Car icon | `animateMotion` on route path | 6s | Loop | linear |
| Pickup pin | Radius pulse 10→16→10 + ring expand | 2s | Loop | ease |
| ETA countdown | Color pulse mint→white→mint | 2s | Tracking active | ease |
| Ride progress bar | Width 12%↔78% alternate | 8s | Tracking active | ease-in-out |
| Bottom sheet | `slide-up` translateY 24→0 | 600ms | Screen enter | decel |
| Request Ride CTA | `breathe-glow` scale 1→1.02 | 2.4s | Home screen | standard |
| Tier card select | Border color + scale 1.02 | 200ms | Tap tier | spring |
| SOS FAB | Coral ring pulse | 1.5s | Always visible | ease |

## App 2 — Driver (Mobile) Motion Table

| Element | Motion | Duration | Trigger | Easing |
|---------|--------|----------|---------|--------|
| Earnings counter | Integer tick + `tick-up` translateY | 2.2s interval | Online mode | ease |
| Online toggle | Background slide + glow | 200ms | Tap | spring |
| Trip request card | Slide-up + coral border glow | 500ms | New request | decel |
| Accept countdown ring | `stroke-dashoffset` 125→0 | 28s | Request visible | linear |
| Accept button | `breathe-glow` | 2.4s | Request visible | standard |
| Nav route line | Dash draw along curve | 4s | Loop | linear |
| Driver position dot | `animateMotion` on nav path | 5s | Loop | linear |
| Heatmap cells | Opacity shimmer stagger | 3s | Earnings tab | linear |

## App 3 — Admin (Desktop Web) Motion Table

| Element | Motion | Duration | Trigger | Easing |
|---------|--------|----------|---------|--------|
| KPI values | JS increment every 2.5s | — | Live data timer | — |
| Bar chart columns | `scaleY(0→1)` staggered | 1.2s + 0.1s delay each | Dashboard load | decel |
| Revenue line overlay | `stroke-dashoffset` draw | 3s | Loop | linear |
| Donut availability | `stroke-dashoffset` 440→88 | 2s | Load once | standard |
| Fleet map pins | Random opacity pulse | 2–4s | Loop per pin | ease |
| Activity feed rows | `slide-up` stagger | 400ms | New event | decel |
| Transaction table row | Background flash on update | 300ms | New trip | standard |
| Sidebar nav active | Background fade 0→15% white | 200ms | Click | standard |

---

## File Map

| App | Live HTML showcase |
|-----|-------------------|
| Rider | `prototypes/showcase/rider-live.html` |
| Driver | `prototypes/showcase/driver-live.html` |
| Admin | `prototypes/showcase/admin-live.html` |
| Hub | `prototypes/showcase/index.html` |
| Shared CSS | `prototypes/showcase/shared-motion.css` |

Open hub: `python3 -m http.server 8767` from `prototypes/showcase/`
