import { scanQrFromCamera } from "./qrScan.js";
import { scanStaffQrFromCamera, isValidStaffExternalId } from "./staffQrScan.js";

const OFFICE_ROLES = ["admin", "operator", "supervisor", "manager"];

function isOfficeRole(role) {
  return OFFICE_ROLES.includes(role);
}

const API_BASE = `${location.origin}/api`;
const WS_BASE = `${location.origin.replace(/^http/, "ws")}`;

const state = {
  token: localStorage.getItem("myride_token") || "",
  user: JSON.parse(localStorage.getItem("myride_user") || "null"),
  socket: null,
  rides: [],
  activeRide: null,
  me: null,
  driverProfile: null,
  trackingTimer: null,
  settings: null,
  geocode: null,
  /** Last ended shift totals from socket `driver:shiftSummary`. */
  lastShiftSummary: null,
  /** OSRM road distance for active ride: { rideId, coordKey, routeKm }. */
  liveRouteKm: null,
  /** Live Tracking shows this ride after "Open" in Ride History (polling otherwise only keeps in-progress rides). */
  customerFocusedRideId: null,
  bookingMap: null,
  bookingMapRedraw: null,
};

const VIEWPORT_STORAGE_KEY = "myride_viewport";
const VIEWPORT_PREVIEW_MIN_WIDTH = 720;

/** Persisted booking form; cleared on customer logout and reset on customer login/register. */
const CUSTOMER_BOOKING_DRAFT_KEY = "myride_booking_draft";

function defaultCustomerBookingDraft() {
  return {
    pickup_text: "",
    dropoff_text: "",
    pickup_lat: null,
    pickup_lng: null,
    dropoff_lat: null,
    dropoff_lng: null,
    pickup_components: {},
    dropoff_components: {},
    passengers: "1",
    payment_method: "card",
  };
}

function clearCustomerBookingDraft() {
  try {
    localStorage.setItem(
      CUSTOMER_BOOKING_DRAFT_KEY,
      JSON.stringify(defaultCustomerBookingDraft())
    );
  } catch {
    /* ignore */
  }
}

/**
 * After customer login/register: blank Book My Ride draft, empty Live Tracking until pickup AND dropoff
 * fields both have text (see `myride_customer_booking_gate`). Ride History still loads from the server.
 */
function onCustomerAuthenticated() {
  clearCustomerBookingDraft();
  sessionStorage.setItem("myride_customer_booking_gate", "1");
  state.activeRide = null;
  state.customerFocusedRideId = null;
  state.liveRouteKm = null;
}

/** Clean up address dropdown listeners/portals before each full re-render (prevents duplicate handlers / stale overlays). */
const __suggestDisposeFns = [];

function disposeSuggestPortals() {
  while (__suggestDisposeFns.length) {
    const fn = __suggestDisposeFns.pop();
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

function getStoredViewport() {
  const v = localStorage.getItem(VIEWPORT_STORAGE_KEY);
  if (v === "tablet" || v === "phone" || v === "pc") return v;
  return "pc";
}

function effectiveViewportMode() {
  const stored = getStoredViewport();
  if (window.innerWidth < VIEWPORT_PREVIEW_MIN_WIDTH) return "pc";
  return stored;
}

function applyViewportToDocument() {
  const mode = effectiveViewportMode();
  if (mode === "pc") document.documentElement.removeAttribute("data-viewport");
  else document.documentElement.setAttribute("data-viewport", mode);
}

function refreshViewportToolbar() {
  const toolbar = document.getElementById("viewportToolbar");
  if (!toolbar) return;
  const effective = effectiveViewportMode();
  const narrow = window.innerWidth < VIEWPORT_PREVIEW_MIN_WIDTH;
  toolbar.querySelectorAll(".viewport-btn").forEach((btn) => {
    const m = btn.dataset.viewport;
    btn.classList.toggle("is-active", m === effective);
    btn.setAttribute("aria-pressed", m === effective ? "true" : "false");
    btn.disabled = narrow && (m === "tablet" || m === "phone");
    if (narrow && (m === "tablet" || m === "phone")) {
      btn.title = "Widen the window to preview tablet or phone width";
    } else {
      btn.title =
        m === "pc"
          ? "Full width — matches a real desktop (default on phones)"
          : m === "tablet"
            ? "Preview ~834px width (centered)"
            : "Preview ~390px phone width (centered)";
    }
  });
  applyViewportToDocument();
}

function setViewportMode(mode) {
  if (mode !== "tablet" && mode !== "phone" && mode !== "pc") mode = "pc";
  localStorage.setItem(VIEWPORT_STORAGE_KEY, mode);
  applyViewportToDocument();
  refreshViewportToolbar();
}

function initViewportToolbar() {
  const toolbar = document.getElementById("viewportToolbar");
  if (!toolbar) return;
  if (!localStorage.getItem(VIEWPORT_STORAGE_KEY)) {
    localStorage.setItem(VIEWPORT_STORAGE_KEY, "pc");
  }
  toolbar.addEventListener("click", (e) => {
    const btn = e.target.closest(".viewport-btn");
    if (!btn || btn.disabled) return;
    setViewportMode(btn.dataset.viewport);
  });
  if (!window.__myrideViewportResizeBound) {
    window.__myrideViewportResizeBound = true;
    window.addEventListener("resize", () => {
      applyViewportToDocument();
      refreshViewportToolbar();
    });
  }
  applyViewportToDocument();
  refreshViewportToolbar();
}

function maybeShowViewportHintAfterLogin() {
  if (sessionStorage.getItem("myride_viewport_hint")) return;
  if (window.innerWidth < VIEWPORT_PREVIEW_MIN_WIDTH) {
    sessionStorage.setItem("myride_viewport_hint", "1");
    return;
  }
  sessionStorage.setItem("myride_viewport_hint", "1");
  toast(
    "Tip: use View · PC / Tablet / Phone to preview layouts (saved on this device). Real phones/tablets already use a responsive layout.",
    "info"
  );
}

const el = (tag, attrs = {}, children = []) => {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k === "class") node.className = v;
    else if (k === "html") node.innerHTML = v;
    else if (k.startsWith("on") && typeof v === "function")
      node.addEventListener(k.slice(2).toLowerCase(), v);
    else node.setAttribute(k, v);
  }
  for (const c of children) if (c) node.append(c);
  return node;
};

const $ = (sel) => document.querySelector(sel);

function toast(msg, kind = "info") {
  const t = $("#toast");
  t.className = `toast ${kind}`;
  t.textContent = msg;
  t.style.display = "block";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.style.display = "none"), 3500);
}

async function api(path, { method = "GET", body, signal } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (state.token) headers["Authorization"] = `Bearer ${state.token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    signal,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const msg =
      (typeof data?.message === "string" && data.message) ||
      data?.error ||
      "request_failed";
    const err = new Error(msg);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/** Leading token like "12" or "12B" from "12 Main St" */
function leadingHouseTokenFromQuery(q) {
  const first = String(q || "")
    .trim()
    .split(/\s+/)[0];
  if (!first || !/^\d/.test(first)) return "";
  if (/^\d+(?:st|nd|rd|th)$/i.test(first)) return "";
  if (!/^\d[\dA-Za-z-]{0,9}$/.test(first)) return "";
  return first;
}

/**
 * If the user typed a house number but the geocoder returns a street-only place (or a different number),
 * force the typed number into components so the input shows "12 Main St".
 */
function mergeTypedLeadingHouseIntoResolved(typedQuery, resolved) {
  const out = { ...(resolved || {}) };
  out.components = { ...(resolved?.components || {}) };
  const n = leadingHouseTokenFromQuery(typedQuery);
  if (!n) return out;

  const existing = String(out.components.street_number || "").trim();
  const norm = (x) => String(x || "").toLowerCase().replace(/\s+/g, "");
  let route = String(out.components.route || "").trim();

  if (!route) {
    const lbl = String(out.label || out.components.formatted_address || "").trim();
    const beforeComma = lbl.split(",")[0].trim();
    route = beforeComma.replace(/^\d[\dA-Za-z-]*\s+/i, "").trim();
  }

  if (!existing || norm(existing) !== norm(n)) {
    out.components.street_number = n;
    if (route) out.components.route = route;
    out.components.street_line = [n, route].filter(Boolean).join(" ").trim();
  }

  return out;
}

/**
 * Stripe Payment Element + confirmPayment (full fare PI). Requires Stripe.js on index.html.
 * @param {{ quiet?: boolean }} [opts] — if quiet, missing Stripe.js / publishable key throws without toasting (caller may fall back to dev mock-pay).
 */
async function runStripeRidePayment(rideId, opts = {}) {
  const quiet = Boolean(opts.quiet);
  if (!window.Stripe) {
    if (!quiet) {
      toast("Stripe.js is not loaded (check index.html).", "error");
    }
    throw new Error("stripe_js_missing");
  }
  const cfg = await api("/payments/public-config");
  if (!cfg.publishable_key) {
    if (!quiet) {
      toast("Server missing STRIPE_PUBLISHABLE_KEY (.env).", "error");
    }
    throw new Error("stripe_publishable_missing");
  }
  const pi = await api("/payments/create-ride-payment", {
    method: "POST",
    body: { ride_id: Number(rideId) },
  });
  if (!pi.client_secret) {
    if (!quiet) {
      toast("Could not start payment (no client_secret).", "error");
    }
    throw new Error("no_client_secret");
  }

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay modal-overlay--stripe-pay";
  const modal = document.createElement("div");
  modal.className = "modal-card";
  modal.appendChild(
    el("div", { class: "modal-h" }, [
      el("div", { class: "modal-title", html: "Pay for ride" }),
      el(
        "button",
        { class: "popup-close", type: "button", onClick: () => overlay.remove() },
        [document.createTextNode("×")]
      ),
    ])
  );
  const mount = el("div", { id: "stripe-pay-mount", class: "stack" });
  modal.appendChild(
    el("div", { class: "modal-b" }, [
      el("div", {
        class: "muted",
        html: "Test card: 4242 4242 4242 4242 — any future expiry, any CVC.",
      }),
      mount,
    ])
  );
  overlay.appendChild(modal);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);

  let stripe;
  let elements;
  try {
    stripe = window.Stripe(cfg.publishable_key);
    elements = stripe.elements({
      clientSecret: pi.client_secret,
      appearance: { theme: "stripe" },
    });
    const payEl = elements.create("payment");
    payEl.mount(mount);
  } catch (e) {
    overlay.remove();
    if (!quiet) {
      toast(e?.message || "Stripe Payment Element failed to load.", "error");
    }
    throw e;
  }

  const actions = el("div", { class: "popup-actions" }, [
    el(
      "button",
      {
        class: "btn",
        type: "button",
        onClick: async () => {
          try {
            const base = `${location.origin}${location.pathname}`;
            const { error } = await stripe.confirmPayment({
              elements,
              confirmParams: {
                return_url: `${base}?ride_paid=1#/customer`,
              },
              redirect: "if_required",
            });
            if (error) {
              toast(error.message || "Payment failed", "error");
              return;
            }
            overlay.remove();
            toast("Payment successful", "success");
            state.customerFocusedRideId = null;
            await loadRides();
            render();
          } catch (e) {
            toast(e.data?.error || e.message, "error");
          }
        },
      },
      [document.createTextNode("Pay now — free (no charges)")]
    ),
  ]);
  modal.querySelector(".modal-b").appendChild(actions);
}

/** After Request Ride (card) or Pay: real Stripe modal when configured; otherwise visible simulated-payment modal. */
async function tryCustomerStripeThenDevMock(rideId) {
  const rideIdNum = Number(rideId);
  if (!Number.isFinite(rideIdNum)) {
    toast("Invalid ride id for payment.", "error");
    return;
  }

  let cfg = {};
  try {
    cfg = await api("/payments/public-config");
  } catch {
    cfg = {};
  }
  const hasPublishable = Boolean(String(cfg?.publishable_key || "").trim());
  const canUseStripeElement =
    typeof window.Stripe === "function" && hasPublishable;

  const runMockAndShowUi = async (fallbackReason) => {
    const res = await api("/payments/mock-pay", {
      method: "POST",
      body: { ride_id: rideIdNum },
    });
    state.customerFocusedRideId = null;
    showSimulatedPaymentModal(res?.ride, { reason: fallbackReason });
  };

  if (!canUseStripeElement) {
    try {
      await runMockAndShowUi(
        !hasPublishable
          ? "No publishable Stripe key on the server (.env STRIPE_PUBLISHABLE_KEY), or Stripe.js was blocked."
          : typeof window.Stripe !== "function"
            ? "Stripe.js did not load (network / Content-Security-Policy)."
            : "Using simulated payment."
      );
    } catch (e2) {
      toast(
        e2?.data?.message ||
          e2?.message ||
          "Simulated payment failed. If production, set ALLOW_MOCK_PAYMENTS=1 or configure Stripe keys.",
        "error"
      );
    }
    await loadRides();
    render();
    return;
  }

  try {
    await runStripeRidePayment(rideIdNum, { quiet: true });
  } catch (e) {
    const code = e?.data?.error || e?.message || "";
    try {
      await runMockAndShowUi(
        code === "payment_init_failed" && e?.data?.message
          ? String(e.data.message)
          : code === "payment_init_failed"
            ? "Stripe could not create a payment — check STRIPE_SECRET_KEY and currency minimums."
            : "Falling back to simulated payment."
      );
    } catch (e2) {
      const combined =
        [e?.data?.message, e?.message, e2?.data?.message, e2?.message]
          .filter(
            (s) =>
              typeof s === "string" &&
              s &&
              !s.startsWith("request_failed")
          )
          .join(" — ") ||
        e2?.data?.error ||
        code;
      toast(
        combined ||
          "Card payment could not start. Check STRIPE_* keys, Admin currency (ZAR min R1), or ALLOW_MOCK_PAYMENTS.",
        "error"
      );
    }
  }
  await loadRides();
  render();
}

function showPopup(message) {
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
  const cardEl = document.createElement("div");
  cardEl.className = "modal-card";
  const header = document.createElement("div");
  header.className = "modal-h";
  const title = document.createElement("div");
  title.className = "modal-title";
  title.textContent = "Notice";
  const closeBtn = document.createElement("button");
  closeBtn.className = "popup-close";
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Close");
  closeBtn.textContent = "×";
  closeBtn.onclick = () => overlay.remove();
  header.appendChild(title);
  header.appendChild(closeBtn);
  const body = document.createElement("div");
  body.className = "modal-b";
  body.appendChild(el("div", { class: "popup-msg", html: message }));
  body.appendChild(
    el("div", { class: "popup-actions" }, [
      el(
        "button",
        {
          class: "btn",
          "data-role": "ok",
          type: "button",
          onClick: () => overlay.remove(),
        },
        [document.createTextNode("Okay")]
      ),
    ])
  );
  cardEl.appendChild(header);
  cardEl.appendChild(body);
  overlay.appendChild(cardEl);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Visible test-mode confirmation after /payments/mock-pay (toast alone is easy to miss). */
function showSimulatedPaymentModal(ride, opts = {}) {
  const reason = opts.reason ? String(opts.reason) : "";
  const overlay = document.createElement("div");
  overlay.className = "modal-overlay modal-overlay--stripe-pay";
  const id = ride?.id != null ? String(ride.id) : "—";
  let fareLabel = "—";
  try {
    if (ride) fareLabel = money(rideFareDisplayCents(ride));
  } catch {
    fareLabel = money(
      Number(ride?.final_fare_cents ?? ride?.fare_estimate_cents) || 0
    );
  }

  const msgHtml = `<p><strong>No real card charge</strong> — this ride is marked <strong>paid</strong> for testing only.</p><p>Ride <strong>#${escapeHtml(id)}</strong> · Reference amount: <strong>${escapeHtml(fareLabel)}</strong></p><p><span class="pill">Free plan checkout</span> <span class="muted">No charges will be made — Stripe mode is off in Settings.</span></p>`;

  const bodyNodes = [
    el("div", { class: "popup-msg", html: msgHtml }),
  ];
  if (reason) {
    bodyNodes.push(
      el(
        "p",
        {
          class: "muted",
          style: "margin-top:10px;font-size:13px;line-height:1.45;",
        },
        [document.createTextNode(reason)]
      )
    );
  }
  bodyNodes.push(
    el("div", { class: "popup-actions" }, [
      el(
        "button",
        {
          class: "btn",
          type: "button",
          onClick: () => overlay.remove(),
        },
        [document.createTextNode("Done")]
      ),
    ])
  );

  const card = el("div", { class: "modal-card" }, [
    el("div", { class: "modal-h" }, [
      el("div", {
        class: "modal-title",
        html: "Payment simulated (test mode)",
      }),
      el(
        "button",
        {
          class: "popup-close",
          type: "button",
          onClick: () => overlay.remove(),
        },
        [document.createTextNode("×")]
      ),
    ]),
    el("div", { class: "modal-b stack" }, bodyNodes),
  ]);
  overlay.appendChild(card);
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) overlay.remove();
  });
  document.body.appendChild(overlay);
}

/**
 * @returns {Promise<{ action: "nearest" | "pin" | "cancel", place?: object }>}
 */
function showNearestVerifiedFallbackPopup({ nearestVerified, introHtml }) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "modal-overlay";
    const finish = (payload) => {
      overlay.remove();
      resolve(payload);
    };

    const header = el("div", { class: "modal-h" }, [
      el("div", { class: "modal-title", html: "Street number not verified" }),
      el(
        "button",
        {
          class: "popup-close",
          type: "button",
          "aria-label": "Close",
          onClick: () => finish({ action: "cancel" }),
        },
        [document.createTextNode("×")]
      ),
    ]);

    const body = el("div", { class: "modal-b stack" }, [
      el("div", {
        class: "popup-msg",
        html:
          introHtml ||
          escapeHtml(
            "The exact street number isn't verified for that Google place."
          ),
      }),
    ]);

    if (nearestVerified?.label) {
      body.appendChild(
        el("div", {
          class: "muted",
          html: `<strong>Closest verified address:</strong><br/>${escapeHtml(nearestVerified.label)}`,
        })
      );
    }

    const actions = el("div", { class: "popup-actions stack" }, []);

    const row = el(
      "div",
      {
        class: "row actions",
        style: "flex-wrap:wrap;gap:8px;width:100%;",
      },
      []
    );

    if (
      nearestVerified?.label &&
      nearestVerified.lat != null &&
      nearestVerified.lng != null
    ) {
      row.appendChild(
        el(
          "button",
          {
            class: "btn",
            type: "button",
            onClick: () => finish({ action: "nearest", place: nearestVerified }),
          },
          [document.createTextNode("Use closest verified address")]
        )
      );
    }

    row.appendChild(
      el(
        "button",
        {
          class: "btn ghost",
          type: "button",
          onClick: () => finish({ action: "pin" }),
        },
        [document.createTextNode("Drop pin on map")]
      )
    );

    row.appendChild(
      el(
        "button",
        {
          class: "btn ghost",
          type: "button",
          onClick: () => finish({ action: "cancel" }),
        },
        [document.createTextNode("Cancel")]
      )
    );

    actions.appendChild(row);
    actions.appendChild(
      el(
        "div",
        {
          class: "muted",
          html: "Tip: expand <strong>Coordinates (advanced)</strong> to paste a Plus Code.",
        }
      )
    );
    body.appendChild(actions);

    const cardEl = el("div", { class: "modal-card" }, [header, body]);
    overlay.appendChild(cardEl);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) finish({ action: "cancel" });
    });
    document.body.appendChild(overlay);
  });
}

function setAuth(token, user) {
  state.token = token || "";
  state.user = user || null;
  localStorage.setItem("myride_token", state.token);
  localStorage.setItem("myride_user", JSON.stringify(state.user));
  $("#btnLogout").style.display = state.token ? "inline-flex" : "none";
  if (state.token && state.user) maybeShowViewportHintAfterLogin();
}

function logout() {
  setAuth("", null);
  if (state.socket) {
    state.socket.disconnect();
    state.socket = null;
  }
  state.me = null;
  state.driverProfile = null;
  state.activeRide = null;
  state.rides = [];
  state.lastShiftSummary = null;
  state.liveRouteKm = null;
  state.customerFocusedRideId = null;
  clearCustomerBookingDraft();
  sessionStorage.removeItem("myride_customer_booking_gate");
  location.hash = "#/";
  toast("Logged out", "info");
}

async function refreshMe() {
  if (!state.token) return;
  const res = await api("/users/me");
  state.me = res.user;
  state.driverProfile = res.driver_profile || null;
}

function connectSocket() {
  if (!state.token || state.socket) return;

  state.socket = io(WS_BASE, {
    auth: { token: state.token },
    transports: ["websocket"],
  });

  state.socket.on("ride:updated", (payload) => {
    if (!payload?.ride) return;
    const pid = Number(payload.ride.id);
    const idx = state.rides.findIndex((r) => Number(r.id) === pid);
    if (idx >= 0) state.rides[idx] = payload.ride;
    else state.rides.unshift(payload.ride);

    if (Number(state.activeRide?.id) === pid) {
      state.activeRide = payload.ride;
    }
    render();
  });

  state.socket.on("ride:request", (payload) => {
    if (!payload?.ride) return;
    toast(`New ride request #${payload.ride.id}`, "success");
    const pid = Number(payload.ride.id);
    const idx = state.rides.findIndex((r) => Number(r.id) === pid);
    if (idx >= 0) state.rides[idx] = payload.ride;
    else state.rides.unshift(payload.ride);
    render();
  });

  state.socket.on("driver:shiftSummary", (payload) => {
    if (!payload) return;
    state.lastShiftSummary = payload;
    const km = Number(payload.total_km);
    const cash = Number(payload.total_cash_fare_cents);
    toast(
      `Shift ended — ${Number.isFinite(km) ? km.toFixed(2) : "0"} km trip · Cash-in ${money(cash)}`,
      "success"
    );
    render();
  });

  state.socket.on("disconnect", () => {
    state.socket = null;
  });
}

function money(cents) {
  const currency = state.settings?.currency || "USD";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
    }).format(Number(cents || 0) / 100);
  } catch {
    return `${currency} ${(Number(cents || 0) / 100).toFixed(2)}`;
  }
}

/** Nearest 0.1 km (e.g. 0.88→0.9, 1.07→1.1). Labels use two decimals: 0.90 km, 1.10 km. */
function roundTripKmNearestTenth(km) {
  const n = Number(km);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 10) / 10;
}

function formatRoundedTripKmLabel(km) {
  return `${roundTripKmNearestTenth(km).toFixed(2)} km`;
}

/** Format SQLite/API `requested_at` for Ride History (local timezone). */
function formatRideBookingTimestamp(requestedAt) {
  if (requestedAt == null || requestedAt === "") return "—";
  const raw = String(requestedAt).trim();
  const asIso = raw.includes("T") ? raw : raw.replace(" ", "T");
  const d = new Date(asIso);
  if (Number.isNaN(d.getTime())) return raw;
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    }).format(d);
  } catch {
    return raw;
  }
}

/** Fare(est) = rand_per_km × km. Uses stored distance_km when set; else pickup↔dropoff km (same basis as Ride kilometers when DB km is NULL); last resort stored cents. */
function fareEstimateDisplayCents(ride) {
  if (!ride) return 0;
  const rawKm = ride.distance_km;
  const hasKm =
    rawKm != null &&
    rawKm !== "" &&
    Number.isFinite(Number(rawKm));
  const rate = Number(state.settings?.rand_per_km ?? 12);
  if (hasKm && Number(rawKm) >= 0 && Number.isFinite(rate) && rate > 0) {
    const km = roundTripKmNearestTenth(Number(rawKm));
    return Math.round(km * rate * 100);
  }
  // When distance_km is NULL, Ride kilometers still shows straight-line — use that for fare before stale fare_estimate_cents (e.g. wrong R10.00 vs 10×2.16 km).
  const sl = straightLineTripKm(ride);
  if (
    sl != null &&
    Number.isFinite(sl) &&
    Number.isFinite(rate) &&
    rate > 0
  ) {
    return Math.round(roundTripKmNearestTenth(sl) * rate * 100);
  }
  const stored = Number(ride.fare_estimate_cents);
  if (Number.isFinite(stored) && stored > 0) {
    return Math.round(stored);
  }
  return Number.isFinite(stored) ? Math.round(stored) : 0;
}

/** Table/history: finalized fare when present, else estimate from km × rate. */
function rideFareDisplayCents(ride) {
  if (!ride) return 0;
  const raw = ride.final_fare_cents;
  if (raw != null && raw !== "" && Number.isFinite(Number(raw))) {
    return Math.round(Number(raw));
  }
  return fareEstimateDisplayCents(ride);
}

/** Live Tracking “Pay with Stripe” — card (or non-cash) rides waiting on payment only. */
function customerRideNeedsStripePay(ride) {
  if (!ride) return false;
  if (ride.payment_method === "cash") return false;
  return ride.payment_status === "requires_payment";
}

function route() {
  const hash = location.hash || "#/";
  let [path] = hash.slice(1).split("?");
  path = path || "/";
  if (path.length > 1) path = path.replace(/\/+$/, "");
  return path;
}

function card(title, contentNodes = [], { id } = {}) {
  return el("div", { class: "card", ...(id ? { id } : {}) }, [
    el("div", { class: "card-h" }, [
      el("div", { class: "card-title", html: title }),
    ]),
    el("div", { class: "card-b" }, contentNodes),
  ]);
}

function inputRow(label, control) {
  const inner =
    control?.classList?.contains?.("pw-wrap")
      ? control.querySelector?.("input.password-input") ||
        control.querySelector?.("input")
      : control;
  if (!inner) {
    return el("div", { class: "row" }, [
      el("label", { class: "label", html: label }),
      control,
    ]);
  }
  const id =
    inner.id ||
    `myride_auto_${Math.random().toString(36).slice(2, 11)}`;
  if (!inner.id) inner.id = id;
  return el("div", { class: "row" }, [
    el("label", { class: "label", html: label, for: id }),
    control,
  ]);
}

function passwordField({ placeholder = "Password", value = "" } = {}) {
  const input = el("input", {
    class: "input password-input",
    placeholder,
    type: "password",
    value,
  });

  const btn = el(
    "button",
    {
      class: "pw-toggle",
      type: "button",
      "aria-label": "Show password",
      onClick: () => {
        const isPw = input.type === "password";
        input.type = isPw ? "text" : "password";
        btn.setAttribute("aria-label", isPw ? "Hide password" : "Show password");
        btn.classList.toggle("is-on", isPw);
      },
    },
    [
      // Eye icon (inline SVG)
      el("span", {
        class: "pw-ic",
        html: `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M12 5c5.5 0 9.7 4.2 11 7-1.3 2.8-5.5 7-11 7S2.3 14.8 1 12c1.3-2.8 5.5-7 11-7Zm0 2C7.8 7 4.4 10 3.3 12 4.4 14 7.8 17 12 17s7.6-3 8.7-5C19.6 10 16.2 7 12 7Zm0 2.25A2.75 2.75 0 1 1 12 14.75a2.75 2.75 0 0 1 0-5.5Zm0 2A0.75 0.75 0 1 0 12 13.75a0.75 0.75 0 0 0 0-1.5Z"/></svg>`,
      }),
    ]
  );

  const wrap = el("div", { class: "pw-wrap" }, [input, btn]);
  return { wrap, input, button: btn };
}

function selectVehicle(value = "Car") {
  const s = el("select", { class: "input" }, [
    el("option", { value: "Car", html: "Car (4 Seater)" }),
    el("option", { value: "MPV", html: "MPV (6 Seater)" }),
  ]);
  s.value = value === "MPV" ? "MPV" : "Car";
  return s;
}

const VEHICLE_OPTIONS = [
  { code: "Car", label: "Car (4 Seater)", capacity: 4 },
  { code: "MPV", label: "MPV (6 Seater)", capacity: 6 },
];

function passengersToVehicleType(passengers) {
  const n = Math.max(1, Math.min(6, Number(passengers) || 1));
  const opt =
    VEHICLE_OPTIONS.find((o) => n <= o.capacity) ||
    VEHICLE_OPTIONS[VEHICLE_OPTIONS.length - 1];
  return opt.code;
}

function vehicleLabel(code) {
  return VEHICLE_OPTIONS.find((o) => o.code === code)?.label || code;
}

function setAddrLoading(inputEl, on) {
  inputEl.classList.toggle("input-loading", on);
  inputEl.setAttribute("aria-busy", on ? "true" : "false");
}

function geoErrorMessage(err) {
  const code = err?.code;
  if (code === 1) {
    return "Location permission denied — allow it for this site, or type your pickup.";
  }
  if (code === 2) {
    return "GPS unavailable here — use “Approximate (IP)” (after setting Admin city) or type your address.";
  }
  if (code === 3) return "Location timed out — try “Approximate (IP)” or type your address.";
  return String(err?.message || "Could not read GPS.");
}

function getPositionOnce(options) {
  return new Promise((resolve, reject) => {
    navigator.geolocation.getCurrentPosition(resolve, reject, options);
  });
}

/**
 * Refine GPS: watch until accuracy improves or timeout, then keep best fix.
 * More accurate than two one-shot reads on many phones/browsers.
 */
function watchBestPosition({
  targetAccuracyM = 40,
  maxMs = 22000,
} = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("no_geolocation"));
      return;
    }
    let best = null;
    let watchId = null;
    let timer = null;
    const finish = (pos) => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      if (timer != null) clearTimeout(timer);
      resolve(pos);
    };
    const fail = (err) => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      if (timer != null) clearTimeout(timer);
      if (best) resolve(best);
      else reject(err);
    };
    watchId = navigator.geolocation.watchPosition(
      (position) => {
        const acc = Number(position.coords?.accuracy);
        if (!Number.isFinite(acc)) return;
        if (!best || acc < Number(best.coords.accuracy)) best = position;
        if (acc <= targetAccuracyM) finish(best);
      },
      fail,
      { enableHighAccuracy: true, maximumAge: 0, timeout: maxMs }
    );
    timer = setTimeout(() => {
      if (watchId != null) navigator.geolocation.clearWatch(watchId);
      if (best) resolve(best);
      else reject(new Error("timeout"));
    }, maxMs);
  });
}

async function getBestPosition() {
  try {
    return await watchBestPosition({
      targetAccuracyM: 25,
      maxMs: 45000,
    });
  } catch {
    // Two one-shot samples (legacy path) if watch fails or times out with no fix.
    const opts1 = { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 };
    const opts2 = { enableHighAccuracy: true, timeout: 25000, maximumAge: 0 };
    try {
      const p1 = await getPositionOnce(opts1);
      let best = p1;
      try {
        const p2 = await getPositionOnce(opts2);
        if (
          Number(p2?.coords?.accuracy) < Number(p1?.coords?.accuracy || Infinity)
        ) {
          best = p2;
        }
      } catch {
        // ignore second sample failure
      }
      return best;
    } catch {
      const coarse = {
        enableHighAccuracy: false,
        timeout: 18000,
        maximumAge: 60000,
      };
      return await getPositionOnce(coarse);
    }
  }
}

/**
 * Address type-ahead with structured components (Google Places or Nominatim via `/api/geocode/suggest`).
 * Google Maps–style: broad list, primary line + locality, arrow keys, explicit choice.
 */
function createAddressSuggest({
  textEl,
  latEl,
  lngEl,
  componentsEl,
  addressRole,
  focusNextEl,
  onApply,
  onFallbackChoosePin,
  getLocationBias,
}) {
  textEl.setAttribute("autocomplete", "off");
  textEl.dataset.addressRole = addressRole;

  const box = document.createElement("div");
  box.className = "suggest-box suggest-box-portal";
  box.setAttribute("role", "listbox");
  box.style.display = "none";
  document.body.appendChild(box);

  box.addEventListener("pointerdown", (e) => e.preventDefault());

  let timer = null;
  let suggestAbort = null;
  let fetchGeneration = 0;
  let items = [];
  let selectedIndex = 0;
  let lastTypedQuery = String(textEl.value || "").trim();

  function splitSuggestionDisplay(s, typedHouse) {
    const raw = String(s?.label || "").trim();
    if (!raw) return { line1: "", line2: "" };
    const parts = raw
      .split(",")
      .map((p) => p.trim())
      .filter(Boolean);
    const first = parts[0] || "";
    let line1 = first;
    if (typedHouse) {
      const hasLeading = /^\d/.test(first);
      if (!hasLeading) line1 = `${typedHouse} ${first}`.trim();
    }
    const line2 = parts.slice(1).join(", ");
    return { line1, line2 };
  }

  function close() {
    box.style.display = "none";
    box.innerHTML = "";
  }

  function positionBox() {
    const r = textEl.getBoundingClientRect();
    box.style.left = `${Math.round(r.left)}px`;
    box.style.top = `${Math.round(r.bottom + 6)}px`;
    box.style.width = `${Math.round(Math.max(r.width, 260))}px`;
  }

  function updateHighlight() {
    const buttons = [...box.querySelectorAll(".suggest-item")];
    buttons.forEach((b, i) => b.classList.toggle("is-primary", i === selectedIndex));
    const cur = buttons[selectedIndex];
    if (cur) cur.scrollIntoView({ block: "nearest" });
  }

  function renderSuggestionList() {
    box.innerHTML = "";
    if (!items.length) {
      close();
      return;
    }
    const typed = String(textEl.value || "").trim();
    const typedHouse = leadingHouseTokenFromQuery(typed);

    items.forEach((s, idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "suggest-item";
      btn.setAttribute("role", "option");
      const { line1, line2 } = splitSuggestionDisplay(s, typedHouse);
      const l1 = document.createElement("span");
      l1.className = "suggest-line1";
      l1.textContent = line1 || String(s.label || "").trim() || "—";
      btn.appendChild(l1);
      if (line2) {
        const l2 = document.createElement("span");
        l2.className = "suggest-line2";
        l2.textContent = line2;
        btn.appendChild(l2);
      }
      if (idx === selectedIndex) btn.classList.add("is-primary");
      btn.addEventListener("pointerdown", (e) => {
        e.preventDefault();
        selectItem(s);
      });
      btn.addEventListener("pointerenter", () => {
        selectedIndex = idx;
        updateHighlight();
      });
      box.appendChild(btn);
    });

    positionBox();
    box.style.display = "block";
  }

  async function resolveSelection(s) {
    if (s.needsDetails && s.googlePlaceResource) {
      setAddrLoading(textEl, true);
      try {
        const typed = encodeURIComponent(lastTypedQuery || "");
        const d = await api(
          `/geocode/google-place?place=${encodeURIComponent(s.googlePlaceResource)}&user_input=${typed}`
        );
        return d;
      } finally {
        setAddrLoading(textEl, false);
      }
    }
    return s;
  }

  function applyResolved(s) {
    const rr = mergeTypedLeadingHouseIntoResolved(lastTypedQuery, s);
    const lat = rr.lat != null ? Number(rr.lat) : NaN;
    const lng = rr.lng != null ? Number(rr.lng) : NaN;
    const streetLine = String(rr.components?.street_line || "").trim();
    textEl.value = streetLine || rr.label || "";
    if (Number.isFinite(lat)) latEl.value = lat.toFixed(7);
    if (Number.isFinite(lng)) lngEl.value = lng.toFixed(7);
    componentsEl.value = JSON.stringify(rr.components || {});
    close();
    onApply?.();
    if (focusNextEl) focusNextEl.focus();
  }

  const NO_STREET_MSG =
    "This address doesn't have a verified street number. Please select a different address.";

  async function selectItem(s) {
    lastTypedQuery = String(textEl.value || "").trim();
    try {
      const resolved = await resolveSelection(s);
      applyResolved(resolved);
    } catch (e) {
      if (e.data?.error === "no_verified_street_number") {
        const choice = await showNearestVerifiedFallbackPopup({
          nearestVerified: e.data?.nearest_verified,
          introHtml: escapeHtml(e.data?.message || NO_STREET_MSG),
        });
        if (choice.action === "nearest" && choice.place) {
          applyResolved(
            mergeTypedLeadingHouseIntoResolved(lastTypedQuery, choice.place)
          );
        } else if (choice.action === "pin") {
          onFallbackChoosePin?.(addressRole);
        }
        return;
      }
      toast(
        e.data?.message || e.message || "Could not load that address.",
        "error"
      );
    }
  }

  async function runSuggest(q) {
    try {
      suggestAbort?.abort();
    } catch {
      /* ignore */
    }
    const ac = new AbortController();
    suggestAbort = ac;

    const gen = ++fetchGeneration;
    setAddrLoading(textEl, true);
    try {
      const params = new URLSearchParams({ q });
      if (state.settings?.country) params.set("country", state.settings.country);
      if (state.settings?.province) params.set("province", state.settings.province);
      if (state.settings?.city) params.set("city", state.settings.city);
      if (typeof getLocationBias === "function") {
        const bi = getLocationBias();
        if (
          bi &&
          Number.isFinite(Number(bi.lat)) &&
          Number.isFinite(Number(bi.lng))
        ) {
          params.set("bias_lat", String(bi.lat));
          params.set("bias_lng", String(bi.lng));
        }
      }
      const res = await api(`/geocode/suggest?${params.toString()}`, {
        signal: ac.signal,
      });
      if (gen !== fetchGeneration) return;
      items = res?.suggestions || [];
      selectedIndex = 0;
      renderSuggestionList();
    } catch (e) {
      if (gen !== fetchGeneration) return;
      if (e?.name === "AbortError") return;
      close();
      items = [];
      const msg =
        e.data?.error ||
        e.message ||
        "Address search failed (network or server). Try again or use coordinates below.";
      toast(msg, "error");
    } finally {
      if (gen === fetchGeneration) setAddrLoading(textEl, false);
    }
  }

  function onInput() {
    const q = String(textEl.value || "").trim();
    lastTypedQuery = q;
    if (q.length < 2) {
      fetchGeneration += 1;
      try {
        suggestAbort?.abort();
      } catch {
        /* ignore */
      }
      setAddrLoading(textEl, false);
      close();
      return;
    }
    if (q.length < 3 && !/^\d/.test(q)) {
      fetchGeneration += 1;
      try {
        suggestAbort?.abort();
      } catch {
        /* ignore */
      }
      setAddrLoading(textEl, false);
      close();
      return;
    }
    clearTimeout(timer);
    const debounceMs = Math.min(
      800,
      Math.max(
        30,
        Number(state.settings?.address_suggest_debounce_ms) || 55
      )
    );
    timer = setTimeout(() => {
      const qNow = String(textEl.value || "").trim();
      if (qNow.length < 2) return;
      if (qNow.length < 3 && !/^\d/.test(qNow)) return;
      runSuggest(qNow).catch(() => close());
    }, debounceMs);
  }

  function onFocus() {
    const qNow = String(textEl.value || "").trim();
    const qOk =
      qNow.length >= 2 && (qNow.length >= 3 || /^\d/.test(qNow));
    if (!qOk) return;
    runSuggest(qNow).catch(() => close());
  }

  function onDocDown(e) {
    if (e.target === textEl) return;
    if (box.contains(e.target)) return;
    close();
  }

  function onBlurSuggest() {
    setTimeout(() => {
      const ae = document.activeElement;
      if (ae === textEl || box.contains(ae)) return;
      close();
    }, 80);
  }

  function onScroll() {
    if (box.style.display === "block") positionBox();
  }

  function onResize() {
    if (box.style.display === "block") positionBox();
  }

  function onKeydown(e) {
    const visible = box.style.display === "block" && items.length > 0;

    if (e.key === "Escape") {
      if (visible) {
        e.preventDefault();
        close();
      }
      return;
    }

    if (!visible || !items.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
      updateHighlight();
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
      updateHighlight();
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const pick = items[selectedIndex] ?? items[0];
      if (pick) selectItem(pick);
    }
  }

  textEl.addEventListener("input", onInput);
  textEl.addEventListener("focus", onFocus);
  textEl.addEventListener("blur", onBlurSuggest);
  textEl.addEventListener("keydown", onKeydown);
  document.addEventListener("pointerdown", onDocDown);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onResize);

  const dispose = () => {
    clearTimeout(timer);
    try {
      suggestAbort?.abort();
    } catch {
      /* ignore */
    }
    close();
    document.removeEventListener("pointerdown", onDocDown);
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onResize);
    textEl.removeEventListener("input", onInput);
    textEl.removeEventListener("focus", onFocus);
    textEl.removeEventListener("blur", onBlurSuggest);
    textEl.removeEventListener("keydown", onKeydown);
    box.remove();
  };
  __suggestDisposeFns.push(dispose);
}

/** First geocode match for typed address (no suggestion dropdown). Used for dropoff on “Request Ride”. */
async function geocodeFirstSuggestion(q, bias) {
  const params = new URLSearchParams({ q: String(q || "").trim() });
  if (state.settings?.country) params.set("country", state.settings.country);
  if (state.settings?.province) params.set("province", state.settings.province);
  if (state.settings?.city) params.set("city", state.settings.city);
  if (
    bias &&
    Number.isFinite(Number(bias.lat)) &&
    Number.isFinite(Number(bias.lng))
  ) {
    params.set("bias_lat", String(bias.lat));
    params.set("bias_lng", String(bias.lng));
  }
  const res = await api(`/geocode/suggest?${params}`);
  const items = res?.suggestions || [];
  if (!items.length) {
    const err = new Error(
      "We could not find that dropoff. Add street and city, then try again."
    );
    err.code = "NO_DROP_MATCH";
    throw err;
  }
  let s = items[0];
  if (s.needsDetails && s.googlePlaceResource) {
    try {
      s = await api(
        `/geocode/google-place?place=${encodeURIComponent(s.googlePlaceResource)}&user_input=${encodeURIComponent(q)}`
      );
    } catch (e) {
      if (e.data?.error === "no_verified_street_number") {
        const err = new Error(
          e.data?.message ||
            "This address doesn't have a verified street number. Please select a different address."
        );
        err.code = "NO_VERIFIED_STREET_NUMBER";
        err.data = e.data;
        throw err;
      }
      throw e;
    }
  }
  return s;
}

function destroyBookingRouteMap() {
  state.bookingMapRedraw = null;
  if (state.bookingMap) {
    try {
      if (state.bookingMap._bookingResizeObserver) {
        state.bookingMap._bookingResizeObserver.disconnect();
        state.bookingMap._bookingResizeObserver = null;
      }
      state.bookingMap.remove();
    } catch {
      /* ignore */
    }
    state.bookingMap = null;
  }
}

/** Leaflet’s default marker PNGs often 404 when using CDN scripts; pins disappear without this. */
function ensureLeafletDefaultIcons() {
  if (!window.L || window.__leafletDefaultIconsFixed) return;
  window.__leafletDefaultIconsFixed = true;
  const base = "https://unpkg.com/leaflet@1.9.4/dist/images/";
  delete window.L.Icon.Default.prototype._getIconUrl;
  window.L.Icon.Default.mergeOptions({
    iconRetinaUrl: `${base}marker-icon-2x.png`,
    iconUrl: `${base}marker-icon.png`,
    shadowUrl: `${base}marker-shadow.png`,
  });
}

function scheduleLeafletSizeFix(map) {
  if (!map?.invalidateSize) return;
  const bump = () => {
    try {
      map.invalidateSize({ animate: false });
    } catch {
      /* ignore */
    }
  };
  requestAnimationFrame(() => {
    bump();
    requestAnimationFrame(bump);
  });
  setTimeout(bump, 120);
  setTimeout(bump, 400);
}

/**
 * Booking map: route preview between pickup/dropoff and click-to-pin when `pinTarget.value` is set.
 */
async function mountBookingMapInteractive(mapEl, ctx) {
  destroyBookingRouteMap();
  if (!mapEl || !window.L) return;

  ensureLeafletDefaultIcons();

  const plat = Number(ctx.pickupLat.value);
  const plng = Number(ctx.pickupLng.value);
  const dlat = Number(ctx.dropoffLat.value);
  const dlng = Number(ctx.dropoffLng.value);

  const centerLat =
    Number.isFinite(plat) && Number.isFinite(dlat)
      ? (plat + dlat) / 2
      : Number.isFinite(plat)
        ? plat
        : 40.7128;
  const centerLng =
    Number.isFinite(plng) && Number.isFinite(dlng)
      ? (plng + dlng) / 2
      : Number.isFinite(plng)
        ? plng
        : -74.006;

  const map = window.L.map(mapEl, {
    zoomControl: true,
    attributionControl: true,
  }).setView([centerLat, centerLng], 13);
  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap",
  }).addTo(map);

  scheduleLeafletSizeFix(map);
  if (typeof ResizeObserver !== "undefined") {
    const ro = new ResizeObserver(() => {
      try {
        map.invalidateSize({ animate: false });
      } catch {
        /* ignore */
      }
    });
    ro.observe(mapEl);
    map._bookingResizeObserver = ro;
  }

  let pickupMarker = null;
  let dropoffMarker = null;
  let routeLayer = null;

  async function redrawMarkersAndRoute() {
    const pLat = Number(ctx.pickupLat.value);
    const pLng = Number(ctx.pickupLng.value);
    const dLat = Number(ctx.dropoffLat.value);
    const dLng = Number(ctx.dropoffLng.value);

    if (pickupMarker) {
      map.removeLayer(pickupMarker);
      pickupMarker = null;
    }
    if (dropoffMarker) {
      map.removeLayer(dropoffMarker);
      dropoffMarker = null;
    }
    if (routeLayer) {
      map.removeLayer(routeLayer);
      routeLayer = null;
    }

    if (Number.isFinite(pLat) && Number.isFinite(pLng)) {
      pickupMarker = window.L.marker([pLat, pLng]).addTo(map).bindPopup("Pickup");
    }
    if (Number.isFinite(dLat) && Number.isFinite(dLng)) {
      dropoffMarker = window.L.marker([dLat, dLng]).addTo(map).bindPopup("Dropoff");
    }

    const haveBoth =
      Number.isFinite(pLat) &&
      Number.isFinite(pLng) &&
      Number.isFinite(dLat) &&
      Number.isFinite(dLng);

    if (haveBoth) {
      try {
        const url = `https://router.project-osrm.org/route/v1/driving/${pLng},${pLat};${dLng},${dLat}?overview=full&geometries=geojson`;
        const r = await fetch(url);
        if (r.ok) {
          const j = await r.json();
          const coords = j.routes?.[0]?.geometry?.coordinates;
          if (coords?.length) {
            const latLngs = coords.map(([x, y]) => [y, x]);
            routeLayer = window.L
              .polyline(latLngs, {
                color: "#6d5efc",
                weight: 5,
                opacity: 0.85,
              })
              .addTo(map);
            map.fitBounds(latLngs, { padding: [24, 24] });
            return;
          }
        }
      } catch {
        /* route preview optional */
      }
      map.fitBounds(
        [
          [pLat, pLng],
          [dLat, dLng],
        ],
        { padding: [40, 40] }
      );
      return;
    }

    if (pickupMarker || dropoffMarker) {
      const pts = [];
      if (pickupMarker) pts.push([pLat, pLng]);
      if (dropoffMarker) pts.push([dLat, dLng]);
      if (pts.length === 1) map.setView(pts[0], 15);
      else map.fitBounds(pts, { padding: [48, 48] });
    }
  }

  map.on("click", async (e) => {
    const role = ctx.pinTarget?.target;
    if (!role) return;
    const lat = e.latlng.lat;
    const lng = e.latlng.lng;
    try {
      const rev = await api(`/geocode/reverse?lat=${lat}&lng=${lng}`);
      const streetLine = String(rev.components?.street_line || "").trim();
      const fallbackLabel = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
      const label = streetLine || rev.label || fallbackLabel;
      if (role === "pickup") {
        ctx.pickupLat.value = lat.toFixed(7);
        ctx.pickupLng.value = lng.toFixed(7);
        ctx.pickupText.value = label;
        ctx.pickupComponents.value = JSON.stringify(rev.components || {});
        ctx.onPickupPinApplied?.();
      } else {
        ctx.dropoffLat.value = lat.toFixed(7);
        ctx.dropoffLng.value = lng.toFixed(7);
        ctx.dropoffText.value = label;
        ctx.dropoffComponents.value = JSON.stringify(rev.components || {});
        ctx.onDropoffPinApplied?.();
      }
      ctx.pinTarget.target = null;
      ctx.refreshPinHint?.();
      ctx.syncDraft?.();
      await redrawMarkersAndRoute();
      toast(
        role === "pickup"
          ? "Pickup set from map pin."
          : "Dropoff set from map pin.",
        "success"
      );
    } catch {
      toast("Could not resolve address for that map point.", "error");
    }
  });

  state.bookingMap = map;
  state.bookingMapRedraw = redrawMarkersAndRoute;
  await redrawMarkersAndRoute();
  scheduleLeafletSizeFix(map);
}

function randomNearCity() {
  const cityLat = 40.7128;
  const cityLng = -74.006;
  return {
    lat: cityLat + (Math.random() - 0.5) * 0.04,
    lng: cityLng + (Math.random() - 0.5) * 0.04,
  };
}

/** Great-circle distance in km between two WGS84 points. */
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Pickup → dropoff straight-line distance (km); matches server fare basis when coords are valid. */
function straightLineTripKm(ride) {
  if (!ride) return null;
  const a = Number(ride.pickup_lat);
  const b = Number(ride.pickup_lng);
  const c = Number(ride.dropoff_lat);
  const d = Number(ride.dropoff_lng);
  if (![a, b, c, d].every(Number.isFinite)) return null;
  return haversineKm(a, b, c, d);
}

/**
 * Ride kilometers shown for fare context = server-stored `distance_km` (same value used for Fare est).
 * Optional OSRM line is informational only when it differs from the fare basis.
 */
function formatTripKmDisplay(ride) {
  if (!ride) return "—";
  const storedRaw = ride.distance_km;
  const hasStored =
    storedRaw != null &&
    storedRaw !== "" &&
    Number.isFinite(Number(storedRaw));
  const storedKm = hasStored ? Number(storedRaw) : null;

  const cached =
    state.liveRouteKm?.rideId === ride.id ? state.liveRouteKm : null;
  const previewKm =
    cached?.routeKm != null && Number.isFinite(cached.routeKm)
      ? cached.routeKm
      : null;

  if (storedKm != null && storedKm >= 0) {
    let line = formatRoundedTripKmLabel(storedKm);
    const prevRounded =
      previewKm != null ? roundTripKmNearestTenth(previewKm) : null;
    const storedRounded = roundTripKmNearestTenth(storedKm);
    if (
      prevRounded != null &&
      Math.abs(prevRounded - storedRounded) >= 0.05
    ) {
      line += ` · road preview ${formatRoundedTripKmLabel(previewKm)}`;
    }
    return line;
  }

  const straight = straightLineTripKm(ride);
  if (straight != null) {
    return formatRoundedTripKmLabel(straight);
  }
  return "—";
}

async function refreshLiveTripRouteKm() {
  const ride = state.activeRide;
  if (!ride) {
    state.liveRouteKm = null;
    return;
  }
  const pla = Number(ride.pickup_lat);
  const pln = Number(ride.pickup_lng);
  const dla = Number(ride.dropoff_lat);
  const dln = Number(ride.dropoff_lng);
  if (![pla, pln, dla, dln].every(Number.isFinite)) {
    state.liveRouteKm = { rideId: ride.id, coordKey: "", routeKm: null };
    return;
  }
  const coordKey = `${pla}:${pln}:${dla}:${dln}`;
  if (
    state.liveRouteKm?.rideId === ride.id &&
    state.liveRouteKm?.coordKey === coordKey
  ) {
    return;
  }
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${pln},${pla};${dln},${dla}?overview=false`;
    const res = await fetch(url);
    const j = await res.json();
    const m = j.routes?.[0]?.distance;
    const routeKm = Number.isFinite(m) ? m / 1000 : null;
    state.liveRouteKm = { rideId: ride.id, coordKey, routeKm };
  } catch {
    state.liveRouteKm = { rideId: ride.id, coordKey, routeKm: null };
  }
}

async function loadRides() {
  if (!state.token) return;
  try {
    // After customer login/register until both pickup & dropoff are filled: show Ride History but no Live Tracking ride.
    if (
      state.user?.role === "customer" &&
      sessionStorage.getItem("myride_customer_booking_gate") === "1"
    ) {
      const res = await api("/rides/mine");
      state.rides = res.rides || [];
      state.activeRide = null;
      state.customerFocusedRideId = null;
      state.liveRouteKm = null;
      void refreshLiveTripRouteKm();
      return;
    }

    const res = await api("/rides/mine");
    state.rides = res.rides || [];
    const ongoing =
      state.rides.find((r) =>
        ["requested", "matched", "accepted", "arriving", "in_progress"].includes(
          r.status
        )
      ) || null;
    if (state.customerFocusedRideId != null) {
      const fid = Number(state.customerFocusedRideId);
      const focused = state.rides.find((r) => Number(r.id) === fid);
      if (focused) {
        state.activeRide = focused;
      } else if (Number(state.activeRide?.id) !== fid) {
        state.activeRide = ongoing;
      }
    } else {
      state.activeRide = ongoing;
    }
    void refreshLiveTripRouteKm();
  } catch {
    // ignore
  }
}

/**
 * Load a past ride into Live Tracking (and focus polling on it) so the customer can see status and pay with Stripe when due.
 * Clicks are also handled via a document-level listener so this still works when the UI re-renders every few seconds.
 */
async function openCustomerHistoryRide(rideId) {
  const rid = Number(rideId);
  if (!Number.isFinite(rid)) return;
  try {
    state.customerFocusedRideId = rid;
    const detail = await api(`/rides/${rid}`);
    if (!detail?.ride) {
      toast("Could not load ride.", "error");
      state.customerFocusedRideId = null;
      return;
    }
    sessionStorage.removeItem("myride_customer_booking_gate");
    state.activeRide = detail.ride;
    await loadRides();
    toast(
      "Loaded this ride in Live Tracking (section above or at the top on small screens).",
      "info"
    );
    render();
    queueMicrotask(() => {
      document
        .getElementById("customer-live-tracking")
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  } catch (err) {
    state.customerFocusedRideId = null;
    toast(
      err?.data?.error || err?.message || "Could not open ride.",
      "error"
    );
  }
}

function viewHome() {
  const appName = el("input", { class: "input", placeholder: "Applicant Name" });
  const surname = el("input", { class: "input", placeholder: "Surname" });
  const idNo = el("input", {
    class: "input",
    placeholder: "ID No. (max 13 digits)",
    inputmode: "numeric",
    maxlength: "13",
  });
  const contactNo = el("input", {
    class: "input",
    placeholder: "Contact No. (max 10 digits)",
    inputmode: "numeric",
    maxlength: "10",
  });
  const address = el("input", { class: "input", placeholder: "Address" });
  const suburb = el("input", { class: "input", placeholder: "Suburb" });
  const city = el("input", { class: "input", placeholder: "Town/City" });
  const postal = el("input", {
    class: "input",
    placeholder: "Postal Code (digits)",
    inputmode: "numeric",
    maxlength: "6",
  });
  const expYears = el("input", {
    class: "input",
    placeholder: "Driving Experience (years)",
    type: "number",
    min: "0",
    max: "80",
  });

  const idDoc = el("input", { class: "input", type: "file", accept: ".pdf,.png,.jpg,.jpeg" });
  const licensePdp = el("input", { class: "input", type: "file", accept: ".pdf,.png,.jpg,.jpeg" });
  const comments = el("textarea", { class: "input textarea", placeholder: "Comments (optional)" });

  const toMockRef = (fileInput) => {
    const f = fileInput?.files?.[0];
    if (!f) return null;
    return `mock://${encodeURIComponent(f.name)}?size=${f.size}&type=${encodeURIComponent(f.type || "unknown")}`;
  };

  const onlyDigits = (s, max) => String(s || "").replace(/\D+/g, "").slice(0, max);
  idNo.addEventListener("input", () => (idNo.value = onlyDigits(idNo.value, 13)));
  contactNo.addEventListener("input", () => (contactNo.value = onlyDigits(contactNo.value, 10)));
  postal.addEventListener("input", () => (postal.value = onlyDigits(postal.value, 6)));

  const submitApp = el(
    "button",
    {
      class: "btn full",
      onClick: async () => {
        try {
          const body = {
            applicant_name: appName.value.trim(),
            applicant_surname: surname.value.trim(),
            id_number: idNo.value.trim(),
            contact_number: contactNo.value.trim(),
            address: address.value.trim(),
            suburb: suburb.value.trim(),
            city: city.value.trim(),
            postal_code: postal.value.trim(),
            driving_experience_years: Number(expYears.value || 0),
            id_document_ref: toMockRef(idDoc),
            license_pdp_ref: toMockRef(licensePdp),
            comments: comments.value.trim() || null,
          };

          const res = await api("/applications", { method: "POST", body });
          toast(`Application submitted (#${res.application_id})`, "success");

          // Reset fields
          appName.value = "";
          surname.value = "";
          idNo.value = "";
          contactNo.value = "";
          address.value = "";
          suburb.value = "";
          city.value = "";
          postal.value = "";
          expYears.value = "";
          idDoc.value = "";
          licensePdp.value = "";
          comments.value = "";
        } catch (e) {
          toast(e.data?.error || e.message, "error");
        }
      },
    },
    [document.createTextNode("Submit Application")]
  );

  const modalOverlay = el("div", { class: "modal-overlay", style: "display:none;" }, []);
  const closeModal = () => {
    modalOverlay.style.display = "none";
  };
  const openModal = () => {
    modalOverlay.style.display = "flex";
  };

  const modalCard = el("div", { class: "modal-card" }, [
    el("div", { class: "modal-h" }, [
      el("div", { class: "modal-title", html: "New Applicant/Driver" }),
      el(
        "button",
        { class: "btn ghost xs", onClick: closeModal, type: "button" },
        [document.createTextNode("Close")]
      ),
    ]),
    el("div", { class: "modal-b" }, [
      el("div", { class: "stack" }, [
        el("div", {
          class: "muted",
          html: "Complete the form below. Uploads are mock for demo.",
        }),
        inputRow("Applicant Name", appName),
        inputRow("Surname", surname),
        inputRow("ID No.", idNo),
        inputRow("Contact No.", contactNo),
        inputRow("Address", address),
        inputRow("Suburb", suburb),
        inputRow("Town/City", city),
        inputRow("Postal Code", postal),
        inputRow("Experience (years)", expYears),
        inputRow("Upload ID Document", idDoc),
        inputRow("Upload Driver License & PDP", licensePdp),
        inputRow("Comments", comments),
        submitApp,
      ]),
    ]),
  ]);

  modalOverlay.append(modalCard);
  modalOverlay.addEventListener("click", (e) => {
    if (e.target === modalOverlay) closeModal();
  });

  const openAppButton = el(
    "button",
    { class: "btn full", onClick: openModal, type: "button" },
    [document.createTextNode("New Applicant/Driver")]
  );

  return el("div", { class: "stack" }, [
    el("div", { class: "hero" }, [
      el("div", { class: "hero-left" }, [
        el("div", { class: "hero-top" }, [
          el("div", { class: "hero-toptext" }, [
            el("div", { class: "badge", html: "Fast - Safe - Reliable" }),
            el("h1", { class: "h1", html: "My Ride" }),
            el("div", { class: "slogan", html: "Serving you since 1949" }),
            el("div", { class: "lead-block" }, [
              el("p", { class: "lead lead-line1", html: "Your complete e-hailing" }),
              el("p", { class: "lead lead-line2", html: "web app" }),
            ]),
          ]),
          el("div", { class: "hero-logo-wrap" }, [
            el("img", {
              class: "hero-logo",
              src: "/logos/My%20Ride.png",
              alt: "My Ride",
              loading: "eager",
            }),
          ]),
        ]),
        el("div", { class: "home-panels" }, [
          el("div", { class: "mini" }, [
            el("div", { class: "mini-title", html: "How booking a ride works" }),
            el("div", {
              class: "mini-text",
              html: "Request → match → accept → ride → pay → complete.",
            }),
          ]),
          el("div", { class: "mini" }, [
            el("div", { class: "mini-title", html: "Safety" }),
            el("div", {
              class: "mini-text",
              html:
                "Approved drivers, Audit events, and Payment confirmation via In-app payment system.",
            }),
          ]),
          el("div", { class: "mini" }, [
            el("div", { class: "mini-title", html: "How to VIEW this e-hailing ecosystem" }),
            el("div", {
              class: "mini-text",
              html: "Activate: Desktop, Tablet or Phone view.",
            }),
          ]),
          el("div", { class: "mini" }, [
            el("div", { class: "mini-title", html: "Office staff & admin" }),
            el("div", {
              class: "mini-text",
              html: "Staff use printed QR cards; admins use PIN.",
            }),
            el(
              "a",
              {
                class: "btn ghost full",
                href: "#/admin",
                style: "margin-top:8px;display:inline-flex;",
              },
              [document.createTextNode("Open Office login")]
            ),
          ]),
          card("New Driver Applications", [
            el("div", { class: "stack" }, [
              el("div", {
                class: "muted",
                html: "Apply to work with My Ride (demo form; uploads are mock).",
              }),
              openAppButton,
              el("div", { class: "divider" }),
              el("div", { class: "muted", html: "Contact: support@myride.com (demo)" }),
            ]),
          ]),
        ]),
      ]),
    ]),
    modalOverlay,
  ]);
}

function authBlock(roleLabel, roleValue) {
  const email = el("input", { class: "input", placeholder: "Email" });
  const { wrap: passwordWrap, input: password } = passwordField({
    placeholder: "Password (min 8)",
  });
  const name = el("input", { class: "input", placeholder: "Full name" });

  const vehicle = selectVehicle("Car");
  const plate = el("input", { class: "input", placeholder: "License plate" });
  const photo = el("input", {
    class: "input",
    placeholder: "Photo URL (mock upload)",
  });

  const register = el(
    "button",
    {
      class: "btn",
      onClick: async () => {
        try {
          const body = {
            role: roleValue,
            email: email.value,
            password: password.value,
            name: name.value,
          };
          if (roleValue === "driver") {
            body.vehicle_type = vehicle.value;
            body.license_plate = plate.value;
            body.photo_url = photo.value || null;
          }
          const res = await api("/users/register", { method: "POST", body });
          setAuth(res.token, res.user);
          if (roleValue === "customer") onCustomerAuthenticated();
          await refreshMe();
          connectSocket();
          await loadRides();
          toast("Registered & logged in", "success");
          render();
        } catch (e) {
          toast(e.data?.error || e.message, "error");
        }
      },
    },
    [document.createTextNode("Register")]
  );

  const login = el(
    "button",
    {
      class: "btn ghost",
      onClick: async () => {
        try {
          const res = await api("/users/login", {
            method: "POST",
            body: { email: email.value, password: password.value },
          });
          setAuth(res.token, res.user);
          if (roleValue === "customer") onCustomerAuthenticated();
          await refreshMe();
          connectSocket();
          await loadRides();
          toast("Logged in", "success");
          render();
        } catch (e) {
          toast(e.data?.error || e.message, "error");
        }
      },
    },
    [document.createTextNode("Login")]
  );

  const fields = [inputRow("Email", email), inputRow("Password", passwordWrap)];
  if (roleValue !== "admin") fields.unshift(inputRow("Name", name));

  if (roleValue === "driver") {
    fields.push(inputRow("Vehicle type", vehicle));
    fields.push(inputRow("License plate", plate));
    fields.push(inputRow("Photo (mock URL)", photo));
  }

  return card(`${roleLabel} Login / Register`, [
    el("div", { class: "stack" }, [
      ...fields,
      el("div", { class: "row actions" }, [register, login]),
      roleValue === "driver"
        ? el("div", {
            class: "muted",
            html: "New drivers require admin approval before going online.",
          })
        : null,
    ]),
  ]);
}

function customerDashboard() {
  destroyBookingRouteMap();

  queueMicrotask(async () => {
    try {
      const sp = new URLSearchParams(location.search);
      if (sp.get("ride_paid") === "1") {
        toast("Payment completed", "success");
        const u = new URL(location.href);
        u.searchParams.delete("ride_paid");
        u.searchParams.delete("payment_intent");
        u.searchParams.delete("payment_intent_client_secret");
        u.searchParams.delete("redirect_status");
        history.replaceState({}, "", `${u.pathname}${u.search}${location.hash}`);
        await loadRides();
        render();
      }
    } catch {
      /* ignore */
    }
  });

  const readDraft = () => {
    try {
      return (
        JSON.parse(localStorage.getItem(CUSTOMER_BOOKING_DRAFT_KEY) || "null") ||
        {}
      );
    } catch {
      return {};
    }
  };
  const writeDraft = (patch) => {
    const cur = readDraft();
    localStorage.setItem(
      CUSTOMER_BOOKING_DRAFT_KEY,
      JSON.stringify({ ...cur, ...patch })
    );
  };

  const draft = readDraft();

  const pickupText = el("input", {
    class: "input",
    placeholder: "Pickup address (street number required)",
  });
  const dropoffText = el("input", {
    class: "input",
    placeholder: "Dropoff address (street number required)",
  });
  const pickupComponents = el("input", { type: "hidden", value: "{}" });
  const dropoffComponents = el("input", { type: "hidden", value: "{}" });
  const passengers = el("input", {
    class: "input",
    type: "number",
    min: "1",
    max: "6",
    step: "1",
    value: String(draft.passengers ?? 1),
    inputmode: "numeric",
  });
  const payment = el(
    "select",
    {
      class: "input",
      id: "customerPaymentMethod",
      name: "payment_method",
      "aria-label": "Payment method",
    },
    [
      el("option", { value: "cash" }, [document.createTextNode("Cash")]),
      el("option", { value: "card" }, [document.createTextNode("Card")]),
    ]
  );
  payment.value = draft.payment_method === "cash" ? "cash" : "card";
  const computedVehicle = el("div", { class: "muted", html: "" });

  const pickup = randomNearCity();
  const dropoff = randomNearCity();

  const pickupLat = el("input", {
    class: "input",
    value: Number(draft.pickup_lat ?? pickup.lat).toFixed(7),
  });
  const pickupLng = el("input", {
    class: "input",
    value: Number(draft.pickup_lng ?? pickup.lng).toFixed(7),
  });
  const dropoffLat = el("input", {
    class: "input",
    value: Number(draft.dropoff_lat ?? dropoff.lat).toFixed(7),
  });
  const dropoffLng = el("input", {
    class: "input",
    value: Number(draft.dropoff_lng ?? dropoff.lng).toFixed(7),
  });

  if (draft.pickup_text) pickupText.value = String(draft.pickup_text);
  if (draft.dropoff_text) dropoffText.value = String(draft.dropoff_text);
  if (draft.pickup_components) {
    pickupComponents.value =
      typeof draft.pickup_components === "object"
        ? JSON.stringify(draft.pickup_components)
        : String(draft.pickup_components);
  }
  if (draft.dropoff_components) {
    dropoffComponents.value =
      typeof draft.dropoff_components === "object"
        ? JSON.stringify(draft.dropoff_components)
        : String(draft.dropoff_components);
  }

  const syncDraft = () => {
    writeDraft({
      pickup_text: pickupText.value,
      dropoff_text: dropoffText.value,
      pickup_lat: pickupLat.value,
      pickup_lng: pickupLng.value,
      dropoff_lat: dropoffLat.value,
      dropoff_lng: dropoffLng.value,
      pickup_components: safeJsonParse(pickupComponents.value, {}),
      dropoff_components: safeJsonParse(dropoffComponents.value, {}),
      passengers: passengers.value,
      payment_method: payment.value,
    });
    const pickupOk = String(pickupText.value || "").trim().length > 0;
    const dropOk = String(dropoffText.value || "").trim().length > 0;
    if (
      pickupOk &&
      dropOk &&
      sessionStorage.getItem("myride_customer_booking_gate") === "1"
    ) {
      sessionStorage.removeItem("myride_customer_booking_gate");
      void loadRides();
    }
  };

  function safeJsonParse(raw, fallback) {
    try {
      return JSON.parse(raw || "{}");
    } catch {
      return fallback;
    }
  }

  let pickupManualCoords = false;
  let dropoffManualCoords = false;
  let dropoffResolvedForQuery = null;
  /** `"pickup"` | `"dropoff"` | null — next map click sets that endpoint */
  const bookingMapPin = { target: null };
  const bookingPinHintEl = el("div", {
    class: "booking-pin-hint muted",
    style: "display:none;margin-top:8px;",
  });
  if (
    draft.dropoff_text &&
    draft.dropoff_lat != null &&
    draft.dropoff_lng != null
  ) {
    dropoffResolvedForQuery = String(draft.dropoff_text).trim();
  }

  pickupText.addEventListener("input", () => {
    pickupManualCoords = false;
  });
  pickupLat.addEventListener("input", () => {
    pickupManualCoords = true;
  });
  pickupLng.addEventListener("input", () => {
    pickupManualCoords = true;
  });

  dropoffText.addEventListener("input", () => {
    dropoffManualCoords = false;
    dropoffResolvedForQuery = null;
  });
  dropoffLat.addEventListener("input", () => {
    dropoffManualCoords = true;
  });
  dropoffLng.addEventListener("input", () => {
    dropoffManualCoords = true;
  });

  function refreshBookingPinHint() {
    const t = bookingMapPin.target;
    bookingPinHintEl.style.display = t ? "block" : "none";
    bookingPinHintEl.textContent =
      t === "pickup"
        ? "Map mode: click the booking map below to set your pickup pin."
        : t === "dropoff"
          ? "Map mode: click the booking map below to set your dropoff pin."
          : "";
  }

  createAddressSuggest({
    textEl: pickupText,
    latEl: pickupLat,
    lngEl: pickupLng,
    componentsEl: pickupComponents,
    addressRole: "pickup",
    focusNextEl: dropoffText,
    onApply: syncDraft,
    onFallbackChoosePin: () => {
      bookingMapPin.target = "pickup";
      refreshBookingPinHint();
      toast("Click the booking map to set pickup.", "info");
    },
  });

  createAddressSuggest({
    textEl: dropoffText,
    latEl: dropoffLat,
    lngEl: dropoffLng,
    componentsEl: dropoffComponents,
    addressRole: "dropoff",
    focusNextEl: passengers,
    getLocationBias: () => {
      const la = Number(pickupLat.value);
      const ln = Number(pickupLng.value);
      if (Number.isFinite(la) && Number.isFinite(ln)) return { lat: la, lng: ln };
      return null;
    },
    onApply: () => {
      dropoffResolvedForQuery = String(dropoffText.value || "").trim();
      dropoffManualCoords = false;
      syncDraft();
    },
    onFallbackChoosePin: () => {
      bookingMapPin.target = "dropoff";
      refreshBookingPinHint();
      toast("Click the booking map to set dropoff.", "info");
    },
  });

  const plusCodeInput = el("input", {
    class: "input",
    type: "text",
    placeholder: "Plus Code + area (e.g. 5G7X+5C London)",
    autocomplete: "off",
  });

  async function applyPlusCode(role) {
    const q = plusCodeInput.value.trim();
    if (q.length < 4) {
      toast("Enter a Plus Code with optional city or region.", "info");
      return;
    }
    try {
      const res = await api(`/geocode/forward?q=${encodeURIComponent(q)}`);
      const p = res.place;
      const streetLine = String(p.components?.street_line || "").trim();
      const label = streetLine || p.label || "";
      if (role === "pickup") {
        pickupLat.value = Number(p.lat).toFixed(7);
        pickupLng.value = Number(p.lng).toFixed(7);
        pickupText.value = label;
        pickupComponents.value = JSON.stringify(p.components || {});
        pickupManualCoords = true;
      } else {
        dropoffLat.value = Number(p.lat).toFixed(7);
        dropoffLng.value = Number(p.lng).toFixed(7);
        dropoffText.value = label;
        dropoffComponents.value = JSON.stringify(p.components || {});
        dropoffManualCoords = true;
        dropoffResolvedForQuery = String(dropoffText.value || "").trim();
      }
      syncDraft();
      await state.bookingMapRedraw?.();
      toast("Plus Code applied.", "success");
    } catch (e) {
      toast(
        e.data?.message ||
          e.data?.error ||
          e.message ||
          "Plus Code lookup failed (needs Google Geocoding API key).",
        "error"
      );
    }
  }

  async function ensureDropoffResolved() {
    const q = String(dropoffText.value || "").trim();
    if (q.length < 3) {
      throw new Error("Enter a dropoff address (at least 3 characters).");
    }
    if (dropoffManualCoords) {
      const dlat = Number(dropoffLat.value);
      const dlng = Number(dropoffLng.value);
      if (!Number.isFinite(dlat) || !Number.isFinite(dlng)) {
        throw new Error("Enter valid dropoff coordinates or edit the address field.");
      }
      return;
    }
    if (dropoffResolvedForQuery === q) return;

    setAddrLoading(dropoffText, true);
    try {
      let raw;
      try {
        raw = await geocodeFirstSuggestion(q, {
          lat: Number(pickupLat.value),
          lng: Number(pickupLng.value),
        });
      } catch (e) {
        if (e.code === "NO_VERIFIED_STREET_NUMBER") {
          const choice = await showNearestVerifiedFallbackPopup({
            nearestVerified: e.data?.nearest_verified,
            introHtml: escapeHtml(
              e.data?.message ||
                e.message ||
                "That place has no verified street number in Google."
            ),
          });
          if (choice.action === "nearest" && choice.place) {
            raw = choice.place;
          } else if (choice.action === "pin") {
            bookingMapPin.target = "dropoff";
            refreshBookingPinHint();
            toast(
              "Click the booking map to place your dropoff pin, then tap Request Ride again.",
              "info"
            );
            throw new Error("MAP_PIN_DROP_PENDING");
          } else {
            throw new Error(
              e.data?.message ||
                "Pick another address, enter a Plus Code, or drop a pin on the map."
            );
          }
        } else {
          throw e;
        }
      }
      const s = mergeTypedLeadingHouseIntoResolved(q, raw);
      const lat = Number(s.lat);
      const lng = Number(s.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
        throw new Error("Could not resolve dropoff coordinates.");
      }
      dropoffLat.value = lat.toFixed(7);
      dropoffLng.value = lng.toFixed(7);
      dropoffComponents.value = JSON.stringify(s.components || {});
      const streetLine = String(s.components?.street_line || "").trim();
      if (streetLine) dropoffText.value = streetLine;
      dropoffResolvedForQuery = q;
      syncDraft();
    } finally {
      setAddrLoading(dropoffText, false);
    }
  }

  function refreshVehicleHint() {
    const vt = passengersToVehicleType(passengers.value);
    computedVehicle.textContent = `Vehicle type (auto): ${vehicleLabel(vt)}`;
  }
  passengers.addEventListener("input", refreshVehicleHint);
  refreshVehicleHint();

  const usePickupLocationBtn = el(
    "button",
    {
      type: "button",
      class: "btn ghost xs",
      title: "Browser GPS (needs permission; use HTTPS or localhost on some networks)",
    },
    [document.createTextNode("Use my current location")]
  );
  const approxPickupIpBtn = el(
    "button",
    {
      type: "button",
      class: "btn ghost xs",
      title: "Coarse area from your public IP (works when GPS is blocked)",
    },
    [document.createTextNode("Approximate (IP)")]
  );
  const pinPickupBtn = el(
    "button",
    {
      type: "button",
      class: "btn ghost xs",
      title: "Then click the booking map below",
      onClick: () => {
        bookingMapPin.target = "pickup";
        refreshBookingPinHint();
        toast("Click the booking map to set pickup.", "info");
      },
    },
    [document.createTextNode("Pin on map")]
  );
  const pinDropoffBtn = el(
    "button",
    {
      type: "button",
      class: "btn ghost xs",
      title: "Then click the booking map below",
      onClick: () => {
        bookingMapPin.target = "dropoff";
        refreshBookingPinHint();
        toast("Click the booking map to set dropoff.", "info");
      },
    },
    [document.createTextNode("Pin on map")]
  );

  usePickupLocationBtn.addEventListener("click", () => {
    if (!navigator.geolocation) {
      toast("Geolocation is not supported in this browser.", "info");
      return;
    }
    if (!window.isSecureContext) {
      if (!sessionStorage.getItem("myride_geo_secure_hint")) {
        sessionStorage.setItem("myride_geo_secure_hint", "1");
        toast(
          "Precise GPS is blocked on this URL. Try http://localhost or HTTPS, or use “Approximate (IP)”.",
          "info"
        );
      }
      return;
    }
    usePickupLocationBtn.disabled = true;
    (async () => {
      try {
        const pos = await getBestPosition();
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const acc = Number(pos.coords.accuracy);
        if (Number.isFinite(acc) && acc > 0 && !sessionStorage.getItem("myride_geo_accuracy_hint")) {
          sessionStorage.setItem("myride_geo_accuracy_hint", "1");
          toast(`GPS accuracy ~${Math.round(acc)}m. Refine pickup with search above if needed.`, "info");
        }
        const rev = await api(`/geocode/reverse?lat=${lat}&lng=${lng}`);
        const streetLine = String(rev.components?.street_line || "").trim();
        pickupText.value = streetLine || rev.label || "";
        pickupLat.value = Number(lat).toFixed(7);
        pickupLng.value = Number(lng).toFixed(7);
        pickupComponents.value = JSON.stringify(rev.components || {});
        pickupManualCoords = true;
        syncDraft();
        await state.bookingMapRedraw?.();
        dropoffText.focus();
      } catch (err) {
        if (!sessionStorage.getItem("myride_geo_gps_hint")) {
          sessionStorage.setItem("myride_geo_gps_hint", "1");
          toast(geoErrorMessage(err), "info");
        }
      } finally {
        usePickupLocationBtn.disabled = false;
      }
    })();
  });

  approxPickupIpBtn.addEventListener("click", async () => {
    approxPickupIpBtn.disabled = true;
    try {
      const rev = await api("/geocode/ip-hint");
      const streetLine = String(rev.components?.street_line || "").trim();
      pickupText.value = streetLine || rev.label || "";
      pickupLat.value = Number(rev.lat).toFixed(7);
      pickupLng.value = Number(rev.lng).toFixed(7);
      pickupComponents.value = JSON.stringify(rev.components || {});
      pickupManualCoords = true;
      syncDraft();
      await state.bookingMapRedraw?.();
      dropoffText.focus();
      if (rev.dev_fallback === "admin_settings") {
        if (!sessionStorage.getItem("myride_geo_approx_hint")) {
          sessionStorage.setItem("myride_geo_approx_hint", "1");
          toast("Local dev: using Admin country/city as an approximate map center.", "info");
        }
      } else if (rev.dev_fallback === "env") {
        if (!sessionStorage.getItem("myride_geo_approx_hint")) {
          sessionStorage.setItem("myride_geo_approx_hint", "1");
          toast("Local dev: using DEV_GEO_FALLBACK_LAT/LNG from .env.", "info");
        }
      } else if (rev.approximate && rev.ip_hint) {
        toast("Approximate area from your network — refine by typing the street if needed.", "info");
      }
    } catch (e) {
      const msg =
        e.data?.message ||
        e.data?.error ||
        e.message ||
        "Could not estimate location from IP.";
      const kind =
        e.status === 400 && e.data?.error === "no_public_ip" ? "info" : "error";
      toast(msg, kind);
    } finally {
      approxPickupIpBtn.disabled = false;
    }
  });

  [
    pickupText,
    dropoffText,
    pickupLat,
    pickupLng,
    dropoffLat,
    dropoffLng,
    pickupComponents,
    dropoffComponents,
    plusCodeInput,
    passengers,
    payment,
  ].forEach((n) =>
    n.addEventListener("input", () => {
      syncDraft();
      void state.bookingMapRedraw?.();
    })
  );

  payment.addEventListener("change", () => {
    syncDraft();
    void state.bookingMapRedraw?.();
    if (payment.value === "cash") {
      showPopup("Please pay the driver upon entering the vehicle.");
    } else if (payment.value === "card") {
      toast(
        "Card selected — tap Request Ride next; the Stripe payment window opens after your ride is created.",
        "info"
      );
    }
  });

  const createRide = el(
    "button",
    {
      type: "button",
      class: "btn",
      onClick: async () => {
        try {
          await ensureDropoffResolved();
          const vehicle_type = passengersToVehicleType(passengers.value);
          const payEl = document.getElementById("customerPaymentMethod");
          const payRaw = String(
            payEl?.value ?? payment.value ?? "cash"
          )
            .trim()
            .toLowerCase();
          const payment_method = payRaw === "card" ? "card" : "cash";
          if (payment_method === "cash") {
            showPopup("Please pay the driver upon entering the vehicle.");
          }
          const pc = safeJsonParse(pickupComponents.value, {});
          const dc = safeJsonParse(dropoffComponents.value, {});
          const body = {
            pickup_text: pickupText.value || "Pickup",
            pickup_lat: Number(pickupLat.value),
            pickup_lng: Number(pickupLng.value),
            pickup_street_number: String(pc.street_number || "").trim() || undefined,
            pickup_route: String(pc.route || "").trim() || undefined,
            dropoff_text: dropoffText.value || "Dropoff",
            dropoff_lat: Number(dropoffLat.value),
            dropoff_lng: Number(dropoffLng.value),
            dropoff_street_number: String(dc.street_number || "").trim() || undefined,
            dropoff_route: String(dc.route || "").trim() || undefined,
            vehicle_type,
            payment_method,
          };

          const res = await api("/rides", { method: "POST", body });
          toast(`Ride #${res.ride.id} created`, "success");
          sessionStorage.removeItem("myride_customer_booking_gate");
          state.customerFocusedRideId = null;
          await loadRides();
          state.activeRide = res.ride;
          render();
          if (payment_method === "card") {
            const rideIdNum = Number(res.ride.id);
            if (!Number.isFinite(rideIdNum)) {
              toast("Invalid ride id for payment.", "error");
            } else {
              toast("Opening card payment…", "info");
              await tryCustomerStripeThenDevMock(rideIdNum);
            }
          } else {
            await loadRides();
            render();
          }
        } catch (e) {
          if (e.message === "MAP_PIN_DROP_PENDING") return;
          toast(
            e.data?.message ||
              e.message ||
              e.data?.error ||
              "Could not book ride.",
            "error"
          );
        }
      },
    },
    [document.createTextNode("Request Ride")]
  );

  const active = state.activeRide;

  const trackingCard = card(
    "Live Tracking (mock)",
    [
    active
      ? el("div", { class: "stack" }, [
          el("div", { class: "kv" }, [
            el("div", { class: "k", html: "Ride" }),
            el("div", { class: "v", html: `#${active.id} (${active.status})` }),
          ]),
          el("div", { class: "kv" }, [
            el("div", { class: "k", html: "Ride kilometers" }),
            el("div", {
              class: "v",
              html: formatTripKmDisplay(active),
            }),
          ]),
          el("div", { class: "kv" }, [
            el("div", { class: "k", html: "Fare (est)" }),
            el("div", { class: "v", html: money(fareEstimateDisplayCents(active)) }),
          ]),
          el("div", { class: "kv" }, [
            el("div", { class: "k", html: "Payment" }),
            el("div", { class: "v", html: active.payment_status }),
          ]),
          el("div", {
            class: "map",
            html:
              '<div class="map-title">Mock map</div><div class="map-box"><div class="muted">Tracking updates via sockets/polling.</div></div>',
          }),
          customerRideNeedsStripePay(active)
            ? el(
                "button",
                {
                  type: "button",
                  class: "btn",
                  onClick: () =>
                    void tryCustomerStripeThenDevMock(Number(active.id)),
                },
                [document.createTextNode("Pay with Stripe (test)")]
              )
            : null,
          el("div", { class: "muted", html: "Driver sim updates every ~5 seconds." }),
        ])
      : el("div", { class: "muted", html: "No active ride. Request one above." }),
    ],
    { id: "customer-live-tracking" }
  );

  const history = card("Ride History", [
    el("div", {
      class: "muted",
      style: "margin-bottom:10px;",
      html: "<strong>Open</strong> loads that ride into <strong>Live Tracking</strong> above (needed for older rides or after refresh). For card rides, pay when you see <strong>Pay with Stripe (test)</strong>. Cash rides: pay the driver on board.",
    }),
    state.rides.length
      ? el(
          "div",
          { class: "table ride-history-table" },
          [
            el("div", {
              class: "tr ride-history-tr ride-history-head ride-history-head-labels",
            }, [
              el("div", { class: "td muted", html: "Vehicle" }),
              el("div", { class: "td muted", html: "Status" }),
              el("div", { class: "td muted right", html: "Fare" }),
              el("div", { class: "td muted", html: "Open" }),
            ]),
            ...state.rides.slice(0, 12).map((r) =>
              el("div", { class: "tr ride-history-tr ride-history-card" }, [
                el("div", { class: "ride-history-card-top" }, [
                  el("div", { class: "ride-history-id", html: `#${r.id}` }),
                  el("div", {
                    class: "ride-history-ts ride-history-ts-corner",
                    html: formatRideBookingTimestamp(r.requested_at),
                  }),
                ]),
                el("div", { class: "ride-history-card-grid" }, [
                  el("div", { class: "td", html: `${r.vehicle_type}` }),
                  el("div", { class: "td", html: `${r.status}` }),
                  el("div", {
                    class: "td right",
                    html: money(rideFareDisplayCents(r)),
                  }),
                  el(
                    "button",
                    {
                      type: "button",
                      class: "btn xs ghost ride-history-open-btn",
                      "data-myride-open-ride": String(r.id),
                    },
                    [document.createTextNode("Open")]
                  ),
                ]),
              ])
            ),
          ]
        )
      : el("div", { class: "muted", html: "No rides yet." }),
  ]);

  const bookingMapEl = el("div", {
    class: "booking-map",
    id: "bookingRouteMap",
  });

  const booking = el("div", { class: "card" }, [
    el("div", { class: "card-h card-h-with-refund-warn" }, [
      el("div", { class: "card-title", html: "Book My Ride" }),
      el("div", {
        class: "no-refunds-neon",
        "aria-hidden": "true",
        html: "NO REFUNDS",
      }),
    ]),
    el("div", { class: "card-b" }, [
      el("div", { class: "stack" }, [
      el("div", { class: "address-field" }, [
        el("div", { class: "address-field-head" }, [
          el("span", { class: "address-field-label", html: "Pickup location" }),
          el("div", { class: "address-actions" }, [
            usePickupLocationBtn,
            approxPickupIpBtn,
            pinPickupBtn,
          ]),
        ]),
        pickupText,
        pickupComponents,
      ]),
      el("div", { class: "address-field" }, [
        el("div", { class: "address-field-head" }, [
          el("span", { class: "address-field-label", html: "Dropoff location" }),
          el("div", { class: "address-actions" }, [pinDropoffBtn]),
        ]),
        dropoffText,
        dropoffComponents,
      ]),
      el("details", { class: "coords-details" }, [
        el("summary", { html: "Coordinates (advanced)" }),
        el("div", { class: "grid-2" }, [
          inputRow("Pickup lat", pickupLat),
          inputRow("Pickup lng", pickupLng),
        ]),
        el("div", { class: "grid-2" }, [
          inputRow("Dropoff lat", dropoffLat),
          inputRow("Dropoff lng", dropoffLng),
        ]),
        el("div", { class: "stack", style: "margin-top:12px;" }, [
          el("div", {
            class: "muted",
            html: "Plus Code (Google Open Location Code)",
          }),
          plusCodeInput,
          el(
            "div",
            {
              class: "row actions",
              style: "flex-wrap:wrap;gap:8px;margin-top:6px;",
            },
            [
              el(
                "button",
                {
                  type: "button",
                  class: "btn ghost xs",
                  onClick: () => applyPlusCode("pickup"),
                },
                [document.createTextNode("Apply to pickup")]
              ),
              el(
                "button",
                {
                  type: "button",
                  class: "btn ghost xs",
                  onClick: () => applyPlusCode("dropoff"),
                },
                [document.createTextNode("Apply to dropoff")]
              ),
            ]
          ),
        ]),
      ]),
      inputRow("Number of passengers?", passengers),
      computedVehicle,
      inputRow("Payment", payment),
      el("div", {
        class: "muted",
        html: "<strong>Card</strong> = pay in the app when due (<strong>Ride History → Open</strong>, then <strong>Pay with Stripe (test)</strong>). <strong>Cash</strong> = pay the driver on board.",
      }),
      el("div", { class: "row actions" }, [createRide]),
      el("div", {
        class: "muted",
        html:
          (state.settings?.geocode_za_only || state.geocode?.geocodeZaOnly
            ? "<strong>ZA-only:</strong> pickup/dropoff search is limited to South Africa. "
            : "") +
          (state.geocode?.provider === "google"
            ? "Address search: Google Places. "
            : "Address search: OpenStreetMap Nominatim. ") +
          "Use <strong>Pin on map</strong> for exact GPS, Plus Codes under Coordinates, or <strong>Use closest verified address</strong> when Google has no exact house number. Route preview is approximate.",
      }),
      bookingPinHintEl,
      el("div", {
        class: "muted",
        style: "font-size:12px;margin-top:4px;",
        html: "Map: OpenStreetMap (interactive). Use <strong>Pin on map</strong> above, then click the map. Address search above uses Google / OSM; this map shows the same coordinates.",
      }),
      bookingMapEl,
    ]),
    ]),
  ]);

  queueMicrotask(() => {
    if (!window.L) {
      bookingMapEl.style.display = "none";
      return;
    }
    bookingMapEl.style.display = "block";
    mountBookingMapInteractive(bookingMapEl, {
      pickupLat,
      pickupLng,
      dropoffLat,
      dropoffLng,
      pickupText,
      dropoffText,
      pickupComponents,
      dropoffComponents,
      pinTarget: bookingMapPin,
      refreshPinHint: refreshBookingPinHint,
      syncDraft,
      onPickupPinApplied: () => {
        pickupManualCoords = true;
      },
      onDropoffPinApplied: () => {
        dropoffManualCoords = true;
        dropoffResolvedForQuery = String(dropoffText.value || "").trim();
      },
    });
  });

  return el("div", { class: "stack customer-dashboard-layout" }, [
    el("div", { class: "grid-2" }, [booking, trackingCard]),
    history,
  ]);
}

function driverDashboard() {
  const dp = state.driverProfile;

  const onlineToggle = el(
    "button",
    {
      class: "btn",
      onClick: async () => {
        if (!state.socket) connectSocket();
        const nowOnline = !(dp?.online);
        state.socket?.emit("driver:setOnline", { online: nowOnline });
        toast(nowOnline ? "You are now online" : "You are now offline", "info");
        await refreshMe();
        render();
      },
    },
    [document.createTextNode(dp?.online ? "Go Offline" : "Go Online")]
  );

  const updateLoc = el(
    "button",
    {
      class: "btn ghost",
      onClick: async () => {
        if (!state.socket) connectSocket();
        const { lat, lng } = randomNearCity();
        state.socket?.emit("driver:updateLocation", { lat, lng });
        toast("Location updated", "success");
        await refreshMe();
        render();
      },
    },
    [document.createTextNode("Update Location (mock)")]
  );

  const active =
    state.rides.find((r) => ["matched", "accepted", "in_progress"].includes(r.status)) ||
    null;

  const requests = card("Incoming Requests", [
    state.rides.filter((r) => r.status === "matched").length
      ? el(
          "div",
          { class: "stack" },
          state.rides
            .filter((r) => r.status === "matched")
            .slice(0, 10)
            .map((r) =>
              el("div", { class: "ride" }, [
                el("div", { class: "ride-top" }, [
                  el("div", { class: "ride-title", html: `Ride #${r.id}` }),
                  el("div", { class: "pill", html: r.vehicle_type }),
                ]),
                el("div", { class: "muted", html: `${r.pickup_text} → ${r.dropoff_text}` }),
                el("div", { class: "row actions" }, [
                  el(
                    "button",
                    {
                      class: "btn xs",
                      onClick: async () => {
                        try {
                          await api(`/rides/${r.id}/accept`, { method: "POST" });
                          toast("Accepted", "success");
                          await loadRides();
                          render();
                        } catch (e) {
                          toast(e.data?.error || e.message, "error");
                        }
                      },
                    },
                    [document.createTextNode("Accept")]
                  ),
                  el(
                    "button",
                    {
                      class: "btn xs ghost",
                      onClick: async () => {
                        try {
                          await api(`/rides/${r.id}/reject`, { method: "POST" });
                          toast("Rejected", "info");
                          await loadRides();
                          render();
                        } catch (e) {
                          toast(e.data?.error || e.message, "error");
                        }
                      },
                    },
                    [document.createTextNode("Reject")]
                  ),
                ]),
              ])
            )
        )
      : el("div", { class: "muted", html: "No ride requests yet." }),
  ]);

  const activeCard = card("Active Ride", [
    active
      ? el("div", { class: "stack" }, [
          el("div", { class: "kv" }, [
            el("div", { class: "k", html: "Ride" }),
            el("div", { class: "v", html: `#${active.id} (${active.status})` }),
          ]),
          el("div", { class: "kv" }, [
            el("div", { class: "k", html: "Route" }),
            el("div", { class: "v", html: `${active.pickup_text} → ${active.dropoff_text}` }),
          ]),
          el("div", { class: "kv" }, [
            el("div", { class: "k", html: "Trip km" }),
            el("div", {
              class: "v",
              html: formatTripKmDisplay(active),
            }),
          ]),
          el("div", { class: "kv" }, [
            el("div", { class: "k", html: "Fare (est)" }),
            el("div", { class: "v", html: money(fareEstimateDisplayCents(active)) }),
          ]),
          el("div", { class: "row actions" }, [
            active.status === "accepted"
              ? el(
                  "button",
                  {
                    class: "btn",
                    onClick: async () => {
                      try {
                        await api(`/rides/${active.id}/start`, { method: "POST" });
                        toast("Ride started", "success");
                        await loadRides();
                        render();
                      } catch (e) {
                        toast(e.data?.error || e.message, "error");
                      }
                    },
                  },
                  [document.createTextNode("Start Ride")]
                )
              : null,
            active.status === "in_progress"
              ? el(
                  "button",
                  {
                    class: "btn",
                    onClick: async () => {
                      try {
                        await api(`/rides/${active.id}/request-payment`, { method: "POST" });
                        toast("Payment required (customer)", "info");
                        await loadRides();
                        render();
                      } catch (e) {
                        toast(e.data?.error || e.message, "error");
                      }
                    },
                  },
                  [document.createTextNode("End Ride → Request Payment")]
                )
              : null,
            active.status === "in_progress"
              ? el(
                  "button",
                  {
                    class: "btn ghost",
                    onClick: async () => {
                      try {
                        await api(`/rides/${active.id}/complete`, { method: "POST" });
                        toast("Ride completed", "success");
                        await loadRides();
                        render();
                      } catch (e) {
                        if (e.status === 402) toast("Payment required before completion", "error");
                        else toast(e.data?.error || e.message, "error");
                      }
                    },
                  },
                  [document.createTextNode("Complete ride")]
                )
              : null,
          ]),
          el("div", {
            class: "map",
            html:
              '<div class="map-title">Mock navigation</div><div class="map-box"><div class="muted">Simulated coordinates only (no real maps).</div></div>',
          }),
        ])
      : el("div", { class: "muted", html: "No active ride assigned." }),
  ]);

  const earnings = card("Earnings", [
    dp
      ? el("div", { class: "stack" }, [
          el("div", { class: "kv" }, [
            el("div", { class: "k", html: "Approval" }),
            el("div", { class: "v", html: dp.approval_status }),
          ]),
          el("div", { class: "kv" }, [
            el("div", { class: "k", html: "Online" }),
            el("div", { class: "v", html: dp.online ? "Yes" : "No" }),
          ]),
          el("div", { class: "kv" }, [
            el("div", { class: "k", html: "Total" }),
            el("div", { class: "v", html: money(dp.earnings_cents) }),
          ]),
        ])
      : el("div", { class: "muted", html: "No driver profile loaded." }),
  ]);

  const shiftSummaryCard = card("Shift totals", [
    state.lastShiftSummary
      ? el("div", { class: "stack" }, [
          el("div", { class: "kv" }, [
            el("div", { class: "k", html: "Trip kilometers" }),
            el("div", {
              class: "v",
              html: `${Number(state.lastShiftSummary.total_km || 0).toFixed(2)} km`,
            }),
          ]),
          el("div", { class: "kv" }, [
            el("div", { class: "k", html: "Total cash-in (cash fares)" }),
            el("div", {
              class: "v",
              html: money(state.lastShiftSummary.total_cash_fare_cents),
            }),
          ]),
          el("div", {
            class: "muted",
            html: "Totals are recorded when you tap Go Offline. Cash rides only increase cash-in.",
          }),
        ])
      : el("div", {
          class: "muted",
          html: "After each shift, totals appear here (trip km + cash collected). Go Offline to finalize.",
        }),
  ]);

  const profileCard = card("Driver Controls", [
    el("div", { class: "stack" }, [
      el("div", {
        class: "muted",
        html: "Tip: run `npm run seed:drivers` or register + get admin approval.",
      }),
      el("div", { class: "row actions" }, [onlineToggle, updateLoc]),
    ]),
  ]);

  const walletIn = el("input", {
    class: "input",
    value: dp?.wallet_address || "",
    placeholder: "Zoneless connected account id (acct_z_...) for USDC payout",
    autocomplete: "off",
  });
  const payoutCard = card("USDC payout (Zoneless)", [
    el("div", {
      class: "muted",
      html: "After a ride is paid in Stripe, the owner triggers a USDC payout to this Zoneless connected account.",
    }),
    inputRow("Payout account", walletIn),
    el(
      "button",
      {
        class: "btn xs",
        type: "button",
        onClick: async () => {
          try {
            await api("/users/driver-profile", {
              method: "PATCH",
              body: { wallet_address: walletIn.value.trim() },
            });
            await refreshMe();
            toast("Payout destination saved", "success");
            render();
          } catch (e) {
            toast(e.data?.error || e.message, "error");
          }
        },
      },
      [document.createTextNode("Save")]
    ),
  ]);

  return el("div", { class: "grid-2" }, [
    profileCard,
    payoutCard,
    requests,
    activeCard,
    earnings,
    shiftSummaryCard,
  ]);
}

async function qrDataUrlForPayload(text) {
  const payload = String(text || "");
  if (globalThis.QRCode?.toDataURL) {
    return globalThis.QRCode.toDataURL(payload, { width: 220, margin: 1 });
  }
  return `https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=${encodeURIComponent(payload)}`;
}

function openStaffQrPrintSheet({ name, role, external_staff_id, qr_payload }) {
  const overlay = el("div", { class: "modal-overlay staff-qr-print-overlay" }, [
    el("div", { class: "modal-card staff-qr-print-modal" }, [
      el("div", { class: "modal-h" }, [
        el("div", { class: "modal-title", html: "Staff QR login card" }),
        el(
          "button",
          {
            class: "btn ghost xs",
            type: "button",
            onClick: () => overlay.remove(),
          },
          [document.createTextNode("Close")]
        ),
      ]),
      el("div", { class: "modal-b staff-qr-print-sheet" }, [
        el("div", { class: "staff-qr-card" }, [
          el("div", { class: "staff-qr-card-brand", html: "My Ride" }),
          el("div", { class: "staff-qr-card-name", html: name }),
          el("div", { class: "staff-qr-card-role pill", html: role }),
          el("img", {
            class: "staff-qr-card-img",
            alt: "Staff login QR code",
            src: "",
          }),
          el("div", { class: "staff-qr-card-id muted", html: external_staff_id }),
          el("div", { class: "muted", html: "Scan at Admin / Office login to sign in." }),
        ]),
        el("div", { class: "row actions wrap" }, [
          el(
            "button",
            {
              class: "btn",
              type: "button",
              onClick: () => window.print(),
            },
            [document.createTextNode("Print card")]
          ),
        ]),
      ]),
    ]),
  ]);
  overlay.querySelector(".staff-qr-card-img").src = "";
  document.body.appendChild(overlay);
  void qrDataUrlForPayload(qr_payload).then((url) => {
    const img = overlay.querySelector(".staff-qr-card-img");
    if (img) img.src = url;
  });
}

function adminDashboard({ isAdmin = false } = {}) {
  const usersBtn = el(
    "button",
    {
      class: "btn ghost",
      onClick: async () => {
        const u = await api("/admin/users");
        adminDashboard._users = u.users;
        render();
      },
    },
    [document.createTextNode("Refresh Users")]
  );

  const driversBtn = el(
    "button",
    {
      class: "btn ghost",
      onClick: async () => {
        const d = await api("/admin/drivers");
        adminDashboard._drivers = d.drivers;
        render();
      },
    },
    [document.createTextNode("Refresh Drivers")]
  );

  const ridesBtn = el(
    "button",
    {
      class: "btn ghost",
      onClick: async () => {
        const r = await api("/admin/rides");
        adminDashboard._rides = r.rides;
        render();
      },
    },
    [document.createTextNode("Refresh Rides")]
  );

  const applicationsBtn = el(
    "button",
    {
      class: "btn ghost",
      onClick: async () => {
        const a = await api("/admin/applications");
        adminDashboard._applications = a.applications;
        render();
      },
    },
    [document.createTextNode("Refresh Applications")]
  );

  const analyticsBtn = el(
    "button",
    {
      class: "btn ghost",
      onClick: async () => {
        const a = await api("/admin/analytics");
        adminDashboard._analytics = a;
        render();
      },
    },
    [document.createTextNode("Analytics")]
  );

  const seedBtn = el(
    "button",
    {
      class: "btn",
      onClick: async () => {
        try {
          await api("/admin/seed-drivers", { method: "POST" });
          toast("Seeded drivers", "success");
          const d = await api("/admin/drivers");
          adminDashboard._drivers = d.drivers;
          render();
        } catch (e) {
          toast(e.data?.error || e.message, "error");
        }
      },
    },
    [document.createTextNode("Seed 8 Drivers")]
  );

  const drivers = adminDashboard._drivers || [];
  const rides = adminDashboard._rides || [];
  const users = adminDashboard._users || [];
  const applications = adminDashboard._applications || [];
  const analytics = adminDashboard._analytics || null;

  const settingsBtn = el(
    "button",
    {
      class: "btn ghost",
      onClick: async () => {
        const current = await api("/settings");
        const ps = await api("/platform-settings");
        const country = el("input", {
          class: "input",
          value: current.country || "ZA",
          placeholder: "Country (ISO2) e.g. ZA",
          maxlength: "2",
        });
        const province = el("input", {
          class: "input",
          value: current.province || "",
          placeholder: "Province/State (optional)",
          maxlength: "60",
        });
        const city = el("input", {
          class: "input",
          value: current.city || "",
          placeholder: "City/Town (optional)",
          maxlength: "60",
        });
        const currency = el("input", {
          class: "input",
          value: current.currency || "ZAR",
          placeholder: "Currency (ISO3) e.g. ZAR",
          maxlength: "3",
        });
        const randPerKm = el("input", {
          class: "input",
          type: "number",
          min: "0.01",
          max: "999",
          step: "0.01",
          value: String(current.rand_per_km ?? 12),
        });
        const fareDistanceSource = el("select", { class: "input" }, [
          el("option", {
            value: "osrm",
            html: "Road distance (OSRM, recommended)",
          }),
          el("option", {
            value: "straight_line",
            html: "Straight-line (haversine only)",
          }),
          el("option", {
            value: "carttrack",
            html: "CartTrack API (fallback OSRM → straight-line)",
          }),
        ]);
        const src = String(current.fare_distance_source || "osrm");
        fareDistanceSource.value = ["straight_line", "osrm", "carttrack"].includes(src)
          ? src
          : "osrm";
        const carttrackUrl = el("input", {
          class: "input",
          type: "url",
          placeholder: "https://… (full CartTrack distance endpoint URL)",
          value: current.carttrack_api_base_url || "",
          maxlength: "500",
        });
        const addressDebounce = el("input", {
          class: "input",
          type: "number",
          min: "30",
          max: "800",
          step: "1",
          value: String(current.address_suggest_debounce_ms ?? 55),
        });

        const zaOnlyCb = el("input", {
          type: "checkbox",
          id: "admin-geocode-za-only",
        });
        if (current.geocode_za_only) zaOnlyCb.checked = true;
        const zaOnlyLabel = el(
          "label",
          {
            class: "row",
            style: "align-items:flex-start;gap:10px;cursor:pointer;margin-top:4px;",
            for: "admin-geocode-za-only",
          },
          [
            zaOnlyCb,
            el("span", {
              html: "<strong>South Africa (ZA) only</strong> — Autocomplete, OpenStreetMap, and Plus Code resolution stay within South Africa (overrides other regions).",
            }),
          ]
        );

        const ownerPct = el("input", {
          class: "input",
          type: "number",
          min: "0",
          max: "100",
          step: "1",
          value: String(ps.owner_commission_pct ?? 51),
        });
        const driverPct = el("input", {
          class: "input",
          type: "number",
          min: "0",
          max: "100",
          step: "1",
          value: String(ps.driver_earnings_pct ?? 49),
        });
        const syncFromOwner = () => {
          let o = Math.round(Number(ownerPct.value) || 0);
          o = Math.max(0, Math.min(100, o));
          ownerPct.value = String(o);
          driverPct.value = String(100 - o);
        };
        const syncFromDriver = () => {
          let d = Math.round(Number(driverPct.value) || 0);
          d = Math.max(0, Math.min(100, d));
          driverPct.value = String(d);
          ownerPct.value = String(100 - d);
        };
        ownerPct.addEventListener("input", syncFromOwner);
        driverPct.addEventListener("input", syncFromDriver);

        const save = el(
          "button",
          {
            class: "btn",
            onClick: async () => {
              try {
                const res = await api("/settings", {
                  method: "PUT",
                  body: {
                    country: String(country.value || "").trim(),
                    currency: String(currency.value || "").trim(),
                    province: String(province.value || "").trim(),
                    city: String(city.value || "").trim(),
                    geocode_za_only: Boolean(zaOnlyCb.checked),
                    rand_per_km: Number(randPerKm.value),
                    address_suggest_debounce_ms: Number(addressDebounce.value),
                    fare_distance_source: String(fareDistanceSource.value || "osrm"),
                    carttrack_api_base_url: String(carttrackUrl.value || "").trim(),
                  },
                });
                state.settings = res.settings;
                await api("/platform-settings", {
                  method: "PUT",
                  body: {
                    owner_commission_pct: Number(ownerPct.value),
                    driver_earnings_pct: Number(driverPct.value),
                  },
                });
                toast("Settings saved", "success");
                document.querySelector(".modal-overlay")?.remove();
                render();
              } catch (e) {
                toast(e.data?.error || e.message, "error");
              }
            },
          },
          [document.createTextNode("Save Settings")]
        );

        const overlay = document.createElement("div");
        overlay.className = "modal-overlay";
        const modal = document.createElement("div");
        modal.className = "modal-card";
        modal.appendChild(
          el("div", { class: "modal-h" }, [
            el("div", { class: "modal-title", html: "Settings" }),
            el("button", { class: "popup-close", type: "button", onClick: () => overlay.remove() }, [
              document.createTextNode("×"),
            ])
          ])
        );
        modal.appendChild(
          el("div", { class: "modal-b" }, [
            el("div", {
              class: "muted",
              html: "These settings affect address search (Pickup/Dropoff) and currency display.",
            }),
            el("div", { class: "divider" }),
            inputRow("Country (ISO2)", country),
            inputRow("Province/State", province),
            inputRow("City/Town", city),
            inputRow("Currency (ISO3)", currency),
            inputRow(
              "Fare: Rand per km (ZAR)",
              randPerKm
            ),
            el("div", {
              class: "muted",
              html: "Estimated fare = Rand/km × trip kilometers. Default uses OSRM driving distance (same idea as live route km); straight-line is optional.",
            }),
            inputRow("Fare distance basis", fareDistanceSource),
            inputRow("CartTrack API URL (optional)", carttrackUrl),
            el("div", {
              class: "muted",
              html: current.carttrack_api_key_configured
                ? "CartTrack API key is set on the server (<code>CARTTRACK_API_KEY</code> in environment). POST JSON body: pickup/dropoff lat/lng; Bearer auth."
                : "For CartTrack: set <code>CARTTRACK_API_KEY</code> in server environment and choose “CartTrack API” above. Endpoint URL is usually provided by CartTrack.",
            }),
            el("div", {
              class: "muted",
              html: "Optional: override OSRM with <code>OSRM_BASE_URL</code> in server env (default public router.project-osrm.org).",
            }),
            inputRow(
              "Address search delay (ms)",
              addressDebounce
            ),
            el("div", {
              class: "muted",
              html: "Lower = faster live suggestions (more API calls). Range 30–800 ms.",
            }),
            zaOnlyLabel,
            el("div", { class: "divider" }),
            el("div", {
              class: "muted",
              html: "Revenue split (Stripe fare vs driver USDC payout). The two percentages must total 100%.",
            }),
            inputRow("Owner commission (%)", ownerPct),
            inputRow("Driver earnings (%)", driverPct),
            el("div", { class: "divider" }),
            el("div", { class: "popup-actions" }, [save]),
          ])
        );
        overlay.appendChild(modal);
        overlay.addEventListener("click", (e) => {
          if (e.target === overlay) overlay.remove();
        });
        document.body.appendChild(overlay);
      },
    },
    [document.createTextNode("Settings")]
  );

  const driversCard = card("Drivers (approve/reject)", [
    drivers.length
      ? el(
          "div",
          { class: "stack" },
          drivers.slice(0, 20).map((d) =>
            el("div", { class: "ride" }, [
              el("div", { class: "ride-top" }, [
                el("div", { class: "ride-title", html: `${d.name} (#${d.id})` }),
                el("div", { class: "pill", html: d.vehicle_type }),
              ]),
              el("div", { class: "muted", html: `${d.email} • Plate ${d.license_plate}` }),
              el("div", { class: "kv" }, [
                el("div", { class: "k", html: "Status" }),
                el("div", { class: "v", html: d.approval_status }),
              ]),
              el("div", { class: "row actions" }, [
                el(
                  "button",
                  {
                    class: "btn xs",
                    onClick: async () => {
                      await api(`/admin/drivers/${d.id}/approval`, {
                        method: "POST",
                        body: { status: "approved" },
                      });
                      toast("Approved", "success");
                      const dd = await api("/admin/drivers");
                      adminDashboard._drivers = dd.drivers;
                      render();
                    },
                  },
                  [document.createTextNode("Approve")]
                ),
                el(
                  "button",
                  {
                    class: "btn xs ghost",
                    onClick: async () => {
                      await api(`/admin/drivers/${d.id}/approval`, {
                        method: "POST",
                        body: { status: "rejected" },
                      });
                      toast("Rejected", "info");
                      const dd = await api("/admin/drivers");
                      adminDashboard._drivers = dd.drivers;
                      render();
                    },
                  },
                  [document.createTextNode("Reject")]
                ),
              ]),
            ])
          )
        )
      : el("div", { class: "muted", html: "No drivers loaded yet. Click Refresh Drivers." }),
  ]);

  const analyticsCard = card("Analytics", [
    analytics
      ? el("div", { class: "stack" }, [
          el("div", { class: "grid-3" }, [
            el("div", { class: "mini" }, [
              el("div", { class: "mini-title", html: "Total users" }),
              el("div", { class: "mini-text", html: String(analytics.totals.total_users) }),
            ]),
            el("div", { class: "mini" }, [
              el("div", { class: "mini-title", html: "Total rides" }),
              el("div", { class: "mini-text", html: String(analytics.totals.total_rides) }),
            ]),
            el("div", { class: "mini" }, [
              el("div", { class: "mini-title", html: "Revenue (paid)" }),
              el("div", { class: "mini-text", html: money(analytics.totals.total_revenue_cents) }),
            ]),
          ]),
          el("div", { class: "muted", html: "Minimal UI; full data available via /api/admin/analytics." }),
        ])
      : el("div", { class: "muted", html: "Click Analytics." }),
  ]);

  const ridesCard = card("Rides (latest)", [
    rides.length
      ? el(
          "div",
          { class: "table" },
          rides.slice(0, 20).map((r) =>
            el("div", { class: "tr" }, [
              el("div", { class: "td", html: `#${r.id}` }),
              el("div", { class: "td", html: r.status }),
              el("div", { class: "td", html: r.customer_email || `customer:${r.customer_id}` }),
              el("div", { class: "td", html: r.driver_email || "-" }),
              el("div", { class: "td right", html: money(rideFareDisplayCents(r)) }),
              el("div", { class: "td right" }, [
                r.status === "completed" &&
                r.payment_status === "paid" &&
                (r.payout_status === "unpaid" || r.payout_status == null)
                  ? el(
                      "button",
                      {
                        class: "btn xs ghost",
                        onClick: async () => {
                          try {
                            await api("/payouts/payout-driver", {
                              method: "POST",
                              body: { ride_id: r.id },
                            });
                            toast("Zoneless payout initiated", "success");
                            const rr = await api("/admin/rides");
                            adminDashboard._rides = rr.rides;
                            render();
                          } catch (e) {
                            toast(
                              e.data?.message || e.data?.error || e.message,
                              "error"
                            );
                          }
                        },
                      },
                      [document.createTextNode("USDC payout")]
                    )
                  : el("span", { class: "muted", html: r.payout_status || "—" }),
              ]),
            ])
          )
        )
      : el("div", { class: "muted", html: "No rides loaded yet. Click Refresh Rides." }),
  ]);

  const usersCard = card("Users (latest)", [
    users.length
      ? el(
          "div",
          { class: "table" },
          users.slice(0, 20).map((u) =>
            el("div", { class: "tr" }, [
              el("div", { class: "td", html: `#${u.id}` }),
              el("div", { class: "td", html: u.role }),
              el("div", { class: "td", html: u.email }),
              el("div", { class: "td", html: u.name }),
              el("div", { class: "td right", html: "" }),
              el("div", { class: "td", html: "" }),
            ])
          )
        )
      : el("div", { class: "muted", html: "No users loaded yet. Click Refresh Users." }),
  ]);

  const controlActions = [usersBtn, driversBtn, ridesBtn, applicationsBtn, analyticsBtn];
  if (isAdmin) controlActions.push(settingsBtn, seedBtn);

  const controls = card(isAdmin ? "Admin Controls" : "Office Controls", [
    el("div", { class: "row actions wrap" }, controlActions),
    el("div", {
      class: "muted",
      html: isAdmin
        ? "Full admin access. Staff use My Ride QR cards; admins use PIN."
        : `Signed in as ${state.user?.role}. Sensitive actions require an admin.`,
    }),
  ]);

  const staffNameInput = el("input", { class: "input", placeholder: "Full name" });
  const staffRoleSelect = el(
    "select",
    { class: "input" },
    [
      el("option", { value: "operator" }, [document.createTextNode("Operator")]),
      el("option", { value: "supervisor" }, [document.createTextNode("Supervisor")]),
      el("option", { value: "manager" }, [document.createTextNode("Manager")]),
    ]
  );
  const staffEmailInput = el("input", {
    class: "input",
    placeholder: "Email (optional — auto-generated if blank)",
    autocomplete: "off",
  });
  const staff = adminDashboard._staff || [];
  const staffListContent =
    staff.length > 0
      ? el(
          "div",
          { class: "stack" },
          staff.slice(0, 15).map((s) =>
            el("div", { class: "ride" }, [
              el("div", { class: "ride-top" }, [
                el("div", { class: "ride-title", html: s.name }),
                el("div", { class: "pill", html: s.role }),
              ]),
              el("div", { class: "muted", html: s.external_id || "—" }),
              el(
                "button",
                {
                  class: "btn xs ghost",
                  type: "button",
                  onClick: () =>
                    openStaffQrPrintSheet({
                      name: s.name,
                      role: s.role,
                      external_staff_id: s.external_id,
                      qr_payload: JSON.stringify({ external_staff_id: s.external_id }),
                    }),
                },
                [document.createTextNode("Reprint card")]
              ),
            ])
          )
        )
      : el("div", {
          class: "muted",
          html: "Create staff, then print their My Ride QR login card.",
        });

  const staffCard = isAdmin
    ? card("Staff QR login cards", [
        el("div", { class: "stack" }, [
          el("div", {
            class: "muted",
            html: "Operators, supervisors, and managers sign in at Admin → Staff login with a printed card.",
          }),
          inputRow("Name", staffNameInput),
          inputRow("Role", staffRoleSelect),
          inputRow("Email (optional)", staffEmailInput),
          el(
            "button",
            {
              class: "btn full",
              type: "button",
              onClick: async () => {
                try {
                  const body = {
                    name: staffNameInput.value.trim(),
                    role: staffRoleSelect.value,
                  };
                  const em = staffEmailInput.value.trim();
                  if (em) body.email = em;
                  const res = await api("/admin/staff", { method: "POST", body });
                  toast("Staff created — print their QR card", "success");
                  staffNameInput.value = "";
                  staffEmailInput.value = "";
                  openStaffQrPrintSheet({
                    name: res.staff.name,
                    role: res.staff.role,
                    external_staff_id: res.external_staff_id,
                    qr_payload: res.qr_payload,
                  });
                  const ss = await api("/admin/staff");
                  adminDashboard._staff = ss.staff;
                  render();
                } catch (e) {
                  toast(e.data?.error || e.message, "error");
                }
              },
            },
            [document.createTextNode("Create staff & print card")]
          ),
          el(
            "button",
            {
              class: "btn ghost full",
              type: "button",
              onClick: async () => {
                try {
                  const ss = await api("/admin/staff");
                  adminDashboard._staff = ss.staff;
                  render();
                } catch (e) {
                  toast(e.data?.error || e.message, "error");
                }
              },
            },
            [document.createTextNode("Refresh staff list")]
          ),
          staffListContent,
        ]),
      ])
    : null;


  const staffChallengeId = el("input", {
    class: "input",
    placeholder: "Challenge ID (from staff login screen)",
    inputmode: "numeric",
  });
  const staffQrId = el("input", {
    class: "input",
    placeholder: "Staff card ID (mr-staff-...)",
    autocomplete: "off",
  });

  const staffConfirmCard = isAdmin
    ? card("Staff QR login (approve)", [
        el("div", { class: "stack" }, [
          el("div", {
            class: "muted",
            html: "When staff QR auto-confirm is off, approve their pending login here.",
          }),
          inputRow("Challenge ID", staffChallengeId),
          inputRow("Staff card ID", staffQrId),
          el(
            "button",
            {
              class: "btn full",
              type: "button",
              onClick: async () => {
                try {
                  await api("/admin/staff-auth/confirm-challenge", {
                    method: "POST",
                    body: {
                      challenge_id: Number(staffChallengeId.value),
                      external_staff_id: staffQrId.value.trim(),
                    },
                  });
                  toast("Staff login approved", "success");
                  staffChallengeId.value = "";
                  staffQrId.value = "";
                } catch (e) {
                  toast(e.data?.error || e.message, "error");
                }
              },
            },
            [document.createTextNode("Approve staff login")]
          ),
        ]),
      ])
    : null;

  const llChallengeId = el("input", {
    class: "input",
    placeholder: "Challenge ID (from driver screen)",
    inputmode: "numeric",
  });
  const llDriverId = el("input", {
    class: "input",
    placeholder: "QR Driver ID / external_driver_id",
    autocomplete: "off",
  });

  const logiclineConfirmCard = isAdmin
    ? card("Logicline QR Login (dev confirm)", [
    el("div", { class: "stack" }, [
      el("div", {
        class: "muted",
        html: "Until Logicline server-to-server webhooks are wired, admins can confirm a pending QR-login challenge here (Option B).",
      }),
      inputRow("Challenge ID", llChallengeId),
      inputRow("Driver ID", llDriverId),
      el(
        "button",
        {
          class: "btn full",
          onClick: async () => {
            try {
              await api("/admin/logicline/confirm-challenge", {
                method: "POST",
                body: {
                  challenge_id: Number(llChallengeId.value),
                  external_driver_id: llDriverId.value.trim(),
                },
              });
              toast("Challenge confirmed", "success");
              llChallengeId.value = "";
              llDriverId.value = "";
            } catch (e) {
              toast(e.data?.error || e.message, "error");
            }
          },
        },
        [document.createTextNode("Confirm Challenge (as Logicline)")]
      ),
    ]),
  ])
    : null;

  const applicationsCard = card("New Driver Applications", [
    applications.length
      ? el(
          "div",
          { class: "stack" },
          applications.slice(0, 25).map((a) =>
            el("div", { class: "ride" }, [
              el("div", { class: "ride-top" }, [
                el("div", { class: "ride-title", html: `Application #${a.id}` }),
                el("div", { class: "pill", html: a.status }),
              ]),
              el("div", { class: "muted", html: `${a.applicant_name} ${a.applicant_surname}` }),
              el("div", { class: "kv" }, [
                el("div", { class: "k", html: "ID No." }),
                el("div", { class: "v", html: a.id_number }),
              ]),
              el("div", { class: "kv" }, [
                el("div", { class: "k", html: "Contact" }),
                el("div", { class: "v", html: a.contact_number }),
              ]),
              el("div", { class: "kv" }, [
                el("div", { class: "k", html: "Location" }),
                el("div", {
                  class: "v",
                  html: `${a.suburb}, ${a.city} (${a.postal_code})`,
                }),
              ]),
              el("div", { class: "kv" }, [
                el("div", { class: "k", html: "Experience" }),
                el("div", { class: "v", html: `${a.driving_experience_years} yrs` }),
              ]),
              el("div", { class: "muted", html: `Address: ${a.address}` }),
              a.comments
                ? el("div", { class: "muted", html: `Comments: ${a.comments}` })
                : null,
              el("div", { class: "row actions" }, [
                el(
                  "button",
                  {
                    class: "btn xs",
                    onClick: async () => {
                      await api(`/admin/applications/${a.id}/status`, {
                        method: "PATCH",
                        body: { status: "reviewed" },
                      });
                      toast("Marked reviewed", "success");
                      const aa = await api("/admin/applications");
                      adminDashboard._applications = aa.applications;
                      render();
                    },
                  },
                  [document.createTextNode("Mark Reviewed")]
                ),
                el(
                  "button",
                  {
                    class: "btn xs",
                    onClick: async () => {
                      await api(`/admin/applications/${a.id}/status`, {
                        method: "PATCH",
                        body: { status: "approved" },
                      });
                      toast("Approved", "success");
                      const aa = await api("/admin/applications");
                      adminDashboard._applications = aa.applications;
                      render();
                    },
                  },
                  [document.createTextNode("Approve")]
                ),
                el(
                  "button",
                  {
                    class: "btn xs ghost",
                    onClick: async () => {
                      await api(`/admin/applications/${a.id}/status`, {
                        method: "PATCH",
                        body: { status: "rejected" },
                      });
                      toast("Rejected", "info");
                      const aa = await api("/admin/applications");
                      adminDashboard._applications = aa.applications;
                      render();
                    },
                  },
                  [document.createTextNode("Reject")]
                ),
              ]),
            ])
          )
        )
      : el("div", { class: "muted", html: "No applications loaded yet. Click Refresh Applications." }),
  ]);

  const gridChildren = [
    staffCard,
    staffConfirmCard,
    controls,
    logiclineConfirmCard,
    applicationsCard,
    driversCard,
    analyticsCard,
    ridesCard,
    usersCard,
  ].filter(Boolean);

  return el("div", { class: "grid-2" }, gridChildren);
}

function buildStaffQrLoginPanel() {
  const qrId = el("input", {
    class: "input",
    placeholder: "Staff card ID (mr-staff-...)",
    autocomplete: "off",
  });
  const challengeBox = el("div", {
    class: "muted",
    html: "Scan your My Ride staff QR card or enter your card ID.",
  });
  let challengeId = null;

  const scanStatus = el("div", { class: "muted", html: "Camera idle." });
  const scanVideo = el("video", { class: "qr-video", playsinline: "", muted: "" });
  let scanAbort = null;

  const scanOverlay = el("div", { class: "modal-overlay", style: "display:none;" }, [
    el("div", { class: "modal-card" }, [
      el("div", { class: "modal-h" }, [
        el("div", { class: "modal-title", html: "Scan staff QR card" }),
        el(
          "button",
          {
            class: "btn ghost xs",
            type: "button",
            onClick: () => {
              scanAbort?.abort();
              scanOverlay.style.display = "none";
            },
          },
          [document.createTextNode("Close")]
        ),
      ]),
      el("div", { class: "modal-b" }, [
        el("div", { class: "muted", html: "Point your camera at your My Ride staff login card." }),
        scanVideo,
        scanStatus,
      ]),
    ]),
  ]);

  const openScan = () => {
    scanAbort?.abort();
    scanAbort = new AbortController();
    scanStatus.textContent = "Starting camera…";
    scanOverlay.style.display = "flex";

    scanStaffQrFromCamera({ signal: scanAbort.signal, videoEl: scanVideo })
      .then(({ raw, staffId }) => {
        qrId.value = staffId || "";
        scanStatus.textContent = `Detected QR. Raw: ${raw}`;
        toast("QR scanned", "success");
        scanOverlay.style.display = "none";
      })
      .catch((e) => {
        if (String(e?.message || e) === "aborted") return;
        scanStatus.textContent = `Scan failed: ${e?.message || e}`;
        toast("QR scan failed", "error");
      });
  };

  const scanBtn = el(
    "button",
    { class: "btn ghost full", type: "button", onClick: openScan },
    [document.createTextNode("Scan QR card")]
  );

  const requestBtn = el(
    "button",
    {
      class: "btn full",
      onClick: async () => {
        try {
          const id = qrId.value.trim();
          if (!isValidStaffExternalId(id)) {
            toast("Invalid staff card ID (must look like mr-staff-...)", "error");
            return;
          }
          const res = await api("/staff-auth/request-challenge", {
            method: "POST",
            body: { external_staff_id: id },
          });
          challengeId = res.challenge_id;
          challengeBox.innerHTML = `
            <div><strong>Login requested.</strong></div>
            <div>Challenge ID: <code>${challengeId}</code></div>
            <div>Expires: <code>${res.expires_at}</code></div>
            <div class="muted" style="margin-top:8px;">
              ${
                res.auto_confirmed
                  ? "Approved automatically (dev). Tap Complete Login below."
                  : "Waiting for an admin to approve this login."
              }
            </div>
          `;
          toast(
            res.auto_confirmed ? "Login approved — complete sign-in" : "Challenge created",
            "info"
          );
        } catch (e) {
          toast(e.data?.error || e.message, "error");
        }
      },
    },
    [document.createTextNode("Request login")]
  );

  const completeBtn = el(
    "button",
    {
      class: "btn full",
      onClick: async () => {
        try {
          if (!challengeId) return toast("Request login first", "error");
          const res = await api("/staff-auth/complete", {
            method: "POST",
            body: { challenge_id: challengeId, external_staff_id: qrId.value.trim() },
          });
          setAuth(res.token, res.user);
          await refreshMe();
          connectSocket();
          await loadRides();
          toast("Signed in with staff QR card", "success");
          render();
        } catch (e) {
          toast(e.data?.error || e.message, "error");
        }
      },
    },
    [document.createTextNode("Complete login")]
  );

  const panel = card("Staff login (QR card)", [
    el("div", { class: "stack" }, [
      el("div", {
        class: "muted",
        html: "For operators, supervisors, and managers. Use your printed My Ride staff card.",
      }),
      scanBtn,
      inputRow("Staff card ID", qrId),
      requestBtn,
      el("div", { class: "divider" }),
      card("Challenge status", [challengeBox]),
      completeBtn,
    ]),
  ]);
  const wrap = el("div", { class: "stack" }, [panel]);
  wrap.appendChild(scanOverlay);
  return wrap;
}

function buildAdminPinLoginPanel() {
  const email = el("input", { class: "input", placeholder: "Admin email" });
  const { wrap: pinWrap, input: pin } = passwordField({ placeholder: "Admin PIN" });
  pin.setAttribute("inputmode", "numeric");
  pin.setAttribute("autocomplete", "current-password");

  const login = el(
    "button",
    {
      class: "btn",
      onClick: async () => {
        try {
          const res = await api("/admin-auth/login", {
            method: "POST",
            body: { email: email.value, pin: pin.value },
          });
          setAuth(res.token, res.user);
          await refreshMe();
          connectSocket();
          await loadRides();
          toast("Admin signed in", "success");
          render();
        } catch (e) {
          toast(e.data?.error || e.message, "error");
        }
      },
    },
    [document.createTextNode("Login with PIN")]
  );

  return card("Admin login (PIN only)", [
    el("div", { class: "stack" }, [
      el("div", {
        class: "muted",
        html: "Admins sign in with email + PIN. Staff must use a QR card (left).",
      }),
      inputRow("Email", email),
      inputRow("PIN", pinWrap),
      el("div", { class: "row actions" }, [login]),
      el("div", {
        class: "muted",
        html: "Bootstrap admin from <code>ADMIN_EMAIL</code> / <code>ADMIN_PASSWORD</code> in <code>.env</code>.",
      }),
    ]),
  ]);
}

function viewCustomer() {
  if (!state.token) {
    return el("div", { class: "grid-2" }, [
      authBlock("Customer", "customer"),
      card("Demo notes", [
        el("div", { class: "stack" }, [
          el("div", { class: "muted", html: "After login, request rides and pay via Stripe test mode." }),
          el("div", { class: "muted", html: "Seed drivers: `npm run seed:drivers` or Admin → Seed Drivers." }),
        ]),
      ]),
    ]);
  }
  if (state.user?.role !== "customer") {
    return card("Wrong role", [
      el("div", { class: "muted", html: `You are logged in as ${state.user?.role}. Logout and login as customer.` }),
    ]);
  }
  return customerDashboard();
}

function viewDriver() {
  if (!state.token) {
    const isValidLogiclineExternalId = (id) => {
      const s = String(id || "").trim();
      return /^ll-[a-z0-9][a-z0-9-]{2,63}$/i.test(s);
    };

    const qrId = el("input", {
      class: "input",
      placeholder: "Logicline Driver ID (example: ll-driver-001)",
      autocomplete: "off",
    });
    const challengeBox = el("div", { class: "muted", html: "No active login challenge." });
    let challengeId = null;

    const scanStatus = el("div", { class: "muted", html: "Camera idle." });
    const scanVideo = el("video", { class: "qr-video", playsinline: "", muted: "" });
    let scanAbort = null;

    const scanOverlay = el("div", { class: "modal-overlay", style: "display:none;" }, [
      el("div", { class: "modal-card" }, [
        el("div", { class: "modal-h" }, [
          el("div", { class: "modal-title", html: "Scan QR" }),
          el(
            "button",
            {
              class: "btn ghost xs",
              type: "button",
              onClick: () => {
                scanAbort?.abort();
                scanOverlay.style.display = "none";
              },
            },
            [document.createTextNode("Close")]
          ),
        ]),
        el("div", { class: "modal-b" }, [
          el("div", { class: "muted", html: "Point your camera at the Logicline QR-ID card." }),
          scanVideo,
          scanStatus,
        ]),
      ]),
    ]);

    const openScan = () => {
      scanAbort?.abort();
      scanAbort = new AbortController();
      scanStatus.textContent = "Starting camera…";
      scanOverlay.style.display = "flex";

      scanQrFromCamera({ signal: scanAbort.signal, videoEl: scanVideo })
        .then(({ raw, driverId }) => {
          qrId.value = driverId || "";
          scanStatus.textContent = `Detected QR. Raw: ${raw}`;
          toast("QR scanned", "success");
          scanOverlay.style.display = "none";
        })
        .catch((e) => {
          if (String(e?.message || e) === "aborted") return;
          scanStatus.textContent = `Scan failed: ${e?.message || e}`;
          toast("QR scan failed", "error");
        });
    };

    const scanBtn = el(
      "button",
      {
        class: "btn ghost full",
        type: "button",
        onClick: openScan,
      },
      [document.createTextNode("Scan QR with Camera")]
    );

    const requestBtn = el(
      "button",
      {
        class: "btn full",
        onClick: async () => {
          try {
            const id = qrId.value.trim();
            if (!isValidLogiclineExternalId(id)) {
              toast("Invalid Logicline Driver ID format (must look like ll-...)", "error");
              return;
            }
            const res = await api("/driver-auth/request-challenge", {
              method: "POST",
              body: { external_driver_id: id },
            });
            challengeId = res.challenge_id;
            challengeBox.innerHTML = `
              <div><strong>Challenge requested.</strong></div>
              <div>Challenge ID: <code>${challengeId}</code></div>
              <div>Expires: <code>${res.expires_at}</code></div>
              <div class="muted" style="margin-top:8px;">
                Next: confirm this login request in Logicline (server-to-server integration).
                Until Logicline is wired in, an admin can confirm the challenge from the Admin panel.
              </div>
            `;
            toast("Challenge created. Confirm it in Logicline.", "info");
          } catch (e) {
            toast(e.data?.error || e.message, "error");
          }
        },
      },
      [document.createTextNode("Request Login Challenge")]
    );

    const completeBtn = el(
      "button",
      {
        class: "btn full",
        onClick: async () => {
          try {
            if (!challengeId) return toast("Create a challenge first", "error");
            const res = await api("/driver-auth/complete", {
              method: "POST",
              body: { challenge_id: challengeId, external_driver_id: qrId.value.trim() },
            });
            setAuth(res.token, res.user);
            await refreshMe();
            connectSocket();
            await loadRides();
            toast("Logged in with QR-ID", "success");
            render();
          } catch (e) {
            toast(e.data?.error || e.message, "error");
          }
        },
      },
      [document.createTextNode("Complete Login")]
    );

    return el("div", { class: "stack" }, [
      el("div", { class: "grid-2" }, [
        card("Driver Login (QR-ID)", [
          el("div", { class: "stack" }, [
            el("div", { class: "muted", html: "Login using your Logicline QR-ID Card (Option B challenge flow)." }),
            scanBtn,
            inputRow("QR Driver ID", qrId),
            requestBtn,
            el("div", { class: "divider" }),
            card("Challenge Status", [challengeBox]),
            completeBtn,
          ]),
        ]),
        card("Notes", [
          el("div", { class: "stack" }, [
            el("div", { class: "muted", html: "Camera QR scanning works best over HTTPS (localhost often works; LAN http may be blocked on some phones)." }),
            el("div", { class: "muted", html: "In production, My Ride requests a challenge from Logicline via server-to-server API key, and Logicline confirms it." }),
            el("div", { class: "muted", html: "Until Logicline is connected, log in as Admin → open “Logicline QR Login (dev confirm)” and enter the Challenge ID + Driver ID." }),
          ]),
        ]),
      ]),
      scanOverlay,
    ]);
  }
  if (state.user?.role !== "driver") {
    return card("Wrong role", [
      el("div", { class: "muted", html: `You are logged in as ${state.user?.role}. Logout and login as driver.` }),
    ]);
  }
  return driverDashboard();
}

function buildOfficeLoginPage() {
  const signedInElsewhere = state.token && !isOfficeRole(state.user?.role);

  const signOutFirst = signedInElsewhere
    ? card("Sign in to the office", [
        el("div", { class: "stack" }, [
          el("div", {
            class: "muted",
            html: `You are signed in as <strong>${state.user?.role}</strong>. Log out first, then use a staff QR card or admin PIN below.`,
          }),
          el(
            "button",
            {
              class: "btn full",
              type: "button",
              onClick: () => {
                logout();
                render();
              },
            },
            [document.createTextNode("Log out")]
          ),
        ]),
      ])
    : null;

  return el("div", { class: "stack office-login-page" }, [
    el("div", { class: "office-login-hero card" }, [
      el("h2", { class: "h2", html: "My Ride — Office login" }),
      el("p", {
        class: "lead",
        html: "Staff: scan your printed QR login card. Admin: email + PIN only.",
      }),
    ]),
    signOutFirst,
    el("div", { class: "grid-2 office-login-grid" }, [
      buildStaffQrLoginPanel(),
      buildAdminPinLoginPanel(),
    ]),
  ]);
}

function viewAdmin() {
  if (!state.token || !isOfficeRole(state.user?.role)) {
    return buildOfficeLoginPage();
  }

  const isAdmin = state.user?.role === "admin";
  if (isAdmin && !adminDashboard._staff) {
    queueMicrotask(async () => {
      try {
        const ss = await api("/admin/staff");
        adminDashboard._staff = ss.staff;
        render();
      } catch {
        /* ignore */
      }
    });
  }

  return adminDashboard({ isAdmin });
}

function render() {
  disposeSuggestPortals();

  $("#apiBase").textContent = API_BASE;
  $("#year").textContent = String(new Date().getFullYear());

  $("#btnLogout").onclick = logout;
  $("#btnLogout").style.display = state.token ? "inline-flex" : "none";

  const view = $("#view");
  view.innerHTML = "";

  const r = route();
  const tab =
    r === "/"
      ? "home"
      : r === "/customer"
        ? "customer"
        : r === "/driver"
          ? "driver"
          : r === "/admin" || r === "/office"
            ? "admin"
            : null;
  document.querySelectorAll(".nav-link").forEach((a) => {
    a.classList.toggle("is-active", tab && a.dataset.tab === tab);
    a.setAttribute(
      "aria-current",
      tab && a.dataset.tab === tab ? "page" : "false"
    );
  });
  if (r === "/") view.append(viewHome());
  else if (r === "/customer") view.append(viewCustomer());
  else if (r === "/driver") view.append(viewDriver());
  else if (r === "/admin" || r === "/office") view.append(viewAdmin());
  else view.append(card("Not found", [el("div", { class: "muted", html: "Unknown route." })]));
}

async function boot() {
  initViewportToolbar();

  try {
    state.settings = await api("/settings");
  } catch {
    state.settings = {
      country: null,
      currency: "USD",
      geocode_za_only: false,
      rand_per_km: 12,
      address_suggest_debounce_ms: 55,
      fare_distance_source: "osrm",
      carttrack_api_base_url: "",
      carttrack_api_key_configured: false,
    };
  }

  try {
    state.geocode = await api("/geocode/config");
  } catch {
    state.geocode = {
      provider: "nominatim",
      googleConfigured: false,
      geocodeZaOnly: false,
    };
  }

  render();

  if (!window.__myrideOpenHistoryRideDelegation) {
    window.__myrideOpenHistoryRideDelegation = true;
    document.body.addEventListener(
      "click",
      (e) => {
        const start =
          e.target instanceof Element
            ? e.target
            : e.target?.parentElement;
        const btn = start?.closest?.("button[data-myride-open-ride]");
        if (!btn) return;
        if (route() !== "/customer") return;
        if (!state.token || state.user?.role !== "customer") return;
        e.preventDefault();
        e.stopPropagation();
        const rid = btn.getAttribute("data-myride-open-ride");
        if (rid == null) return;
        void openCustomerHistoryRide(rid);
      },
      true
    );
  }

  if (state.token) {
    try {
      await refreshMe();
      connectSocket();
      await loadRides();
      render();
    } catch {
      logout();
    }
  }

  window.addEventListener("hashchange", () => render());

  state.trackingTimer = setInterval(async () => {
    if (!state.token) return;
    if (!["customer", "driver"].includes(state.user?.role)) return;
    try {
      // Avoid destroying input focus while typing addresses (closes suggestion list).
      if (route() === "/customer") {
        const ae = document.activeElement;
        if (ae && ae.tagName === "INPUT" && ae.classList.contains("input")) {
          if (ae.dataset?.addressRole === "pickup" || ae.dataset?.addressRole === "dropoff") {
            await loadRides();
            return;
          }
        }
      }
      await loadRides();
      render();
    } catch {
      // ignore
    }
  }, 3000);
}

boot();

