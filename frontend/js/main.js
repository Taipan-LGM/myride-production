import { scanQrFromCamera } from "./qrScan.js";

const API_BASE = `${location.origin}/api`;

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
  bookingMap: null,
};

const VIEWPORT_STORAGE_KEY = "myride_viewport";
const VIEWPORT_PREVIEW_MIN_WIDTH = 720;

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

async function api(path, { method = "GET", body } = {}) {
  const headers = { "Content-Type": "application/json" };
  if (state.token) headers["Authorization"] = `Bearer ${state.token}`;
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = { raw: text };
  }
  if (!res.ok) {
    const err = new Error(data?.error || "request_failed");
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
 */
async function runStripeRidePayment(rideId) {
  if (!window.Stripe) {
    toast("Stripe.js is not loaded (check index.html).", "error");
    return;
  }
  const cfg = await api("/payments/public-config");
  if (!cfg.publishable_key) {
    toast("Server missing STRIPE_PUBLISHABLE_KEY (.env).", "error");
    return;
  }
  const pi = await api("/payments/create-ride-payment", {
    method: "POST",
    body: { ride_id: rideId },
  });
  if (!pi.client_secret) {
    toast("Could not start payment (no client_secret).", "error");
    return;
  }

  const overlay = document.createElement("div");
  overlay.className = "modal-overlay";
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

  const stripe = window.Stripe(cfg.publishable_key);
  const elements = stripe.elements({
    clientSecret: pi.client_secret,
    appearance: { theme: "stripe" },
  });
  const payEl = elements.create("payment");
  payEl.mount(mount);

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
            await loadRides();
            render();
          } catch (e) {
            toast(e.data?.error || e.message, "error");
          }
        },
      },
      [document.createTextNode("Pay now")]
    ),
  ]);
  modal.querySelector(".modal-b").appendChild(actions);
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

  state.socket = io({
    auth: { token: state.token },
  });

  state.socket.on("ride:updated", (payload) => {
    if (!payload?.ride) return;
    const idx = state.rides.findIndex((r) => r.id === payload.ride.id);
    if (idx >= 0) state.rides[idx] = payload.ride;
    else state.rides.unshift(payload.ride);

    if (state.activeRide?.id === payload.ride.id) {
      state.activeRide = payload.ride;
    }
    render();
  });

  state.socket.on("ride:request", (payload) => {
    if (!payload?.ride) return;
    toast(`New ride request #${payload.ride.id}`, "success");
    const idx = state.rides.findIndex((r) => r.id === payload.ride.id);
    if (idx >= 0) state.rides[idx] = payload.ride;
    else state.rides.unshift(payload.ride);
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

function route() {
  const hash = location.hash || "#/";
  const [path] = hash.slice(1).split("?");
  return path || "/";
}

function card(title, contentNodes = []) {
  return el("div", { class: "card" }, [
    el("div", { class: "card-h" }, [
      el("div", { class: "card-title", html: title }),
    ]),
    el("div", { class: "card-b" }, contentNodes),
  ]);
}

function inputRow(label, input) {
  return el("div", { class: "row" }, [
    el("label", { class: "label", html: label }),
    input,
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
 */
function createAddressSuggest({
  textEl,
  latEl,
  lngEl,
  componentsEl,
  addressRole,
  focusNextEl,
  onApply,
}) {
  textEl.setAttribute("autocomplete", "off");
  textEl.dataset.addressRole = addressRole;

  const box = document.createElement("div");
  box.className = "suggest-box suggest-box-portal";
  box.style.display = "none";
  document.body.appendChild(box);

  box.addEventListener("pointerdown", (e) => e.preventDefault());

  let timer = null;
  let lastFetchedQuery = "";
  let fetchGeneration = 0;
  let items = [];
  let lastTypedQuery = String(textEl.value || "").trim();

  function close() {
    box.style.display = "none";
    box.innerHTML = "";
  }

  function positionBox() {
    const r = textEl.getBoundingClientRect();
    box.style.left = `${Math.round(r.left)}px`;
    box.style.top = `${Math.round(r.bottom + 6)}px`;
    box.style.width = `${Math.round(Math.max(r.width, 220))}px`;
  }

  function open() {
    if (!items.length) return close();
    positionBox();
    box.style.display = "block";
  }

  async function resolveSelection(s) {
    if (s.needsDetails && s.googlePlaceResource) {
      setAddrLoading(textEl, true);
      try {
        const d = await api(
          `/geocode/google-place?place=${encodeURIComponent(s.googlePlaceResource)}`
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
    lastFetchedQuery = String(textEl.value || "").trim();
    close();
    onApply?.();
    if (focusNextEl) focusNextEl.focus();
  }

  async function selectItem(s) {
    lastTypedQuery = String(textEl.value || "").trim();
    const resolved = await resolveSelection(s);
    applyResolved(resolved);
  }

  async function runSuggest(q) {
    const gen = ++fetchGeneration;
    setAddrLoading(textEl, true);
    try {
      const params = new URLSearchParams({ q });
      if (state.settings?.country) params.set("country", state.settings.country);
      if (state.settings?.province) params.set("province", state.settings.province);
      if (state.settings?.city) params.set("city", state.settings.city);
      const res = await api(`/geocode/suggest?${params.toString()}`);
      if (gen !== fetchGeneration) return;
      items = res?.suggestions || [];
      lastFetchedQuery = q;
      box.innerHTML = "";

      const typed = String(textEl.value || "").trim();
      const typedHouse = leadingHouseTokenFromQuery(typed);
      const fmtSuggestionLabel = (s) => {
        const raw = String(s?.label || "").trim();
        if (!raw) return "";
        const first = raw.split(",")[0].trim();
        if (!typedHouse) return first;
        const hasLeading = /^\d/.test(first);
        if (hasLeading) return first;
        return `${typedHouse} ${first}`.trim();
      };

      for (const s of items) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "suggest-item";
        btn.textContent = fmtSuggestionLabel(s) || s.label;
        if (s === items[0]) btn.classList.add("is-primary");
        btn.addEventListener("pointerdown", (e) => {
          e.preventDefault();
          selectItem(s).catch(() => close());
        });
        box.appendChild(btn);
      }
      open();
    } catch (e) {
      if (gen !== fetchGeneration) return;
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
      lastFetchedQuery = "";
      fetchGeneration += 1;
      setAddrLoading(textEl, false);
      close();
      return;
    }
    if (q.length < 3 && !/^\d/.test(q)) {
      lastFetchedQuery = "";
      fetchGeneration += 1;
      setAddrLoading(textEl, false);
      close();
      return;
    }
    clearTimeout(timer);
    timer = setTimeout(() => {
      const qNow = String(textEl.value || "").trim();
      if (qNow.length < 2) return;
      if (qNow.length < 3 && !/^\d/.test(qNow)) return;
      if (qNow === lastFetchedQuery) return;
      runSuggest(qNow).catch(() => close());
    }, 160);
  }

  function onFocus() {
    open();
  }

  function onDocDown(e) {
    if (e.target === textEl) return;
    if (box.contains(e.target)) return;
    close();
  }

  function onScroll() {
    if (box.style.display === "block") positionBox();
  }

  function onResize() {
    if (box.style.display === "block") positionBox();
  }

  function onKeydown(e) {
    if (e.key !== "Enter" && e.key !== "Tab") return;
    if (!items.length) return;
    e.preventDefault();
    selectItem(items[0]).catch(() => close());
  }

  textEl.addEventListener("input", onInput);
  textEl.addEventListener("focus", onFocus);
  textEl.addEventListener("keydown", onKeydown);
  document.addEventListener("pointerdown", onDocDown);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("resize", onResize);

  const dispose = () => {
    clearTimeout(timer);
    close();
    document.removeEventListener("pointerdown", onDocDown);
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("resize", onResize);
    textEl.removeEventListener("input", onInput);
    textEl.removeEventListener("focus", onFocus);
    textEl.removeEventListener("keydown", onKeydown);
    box.remove();
  };
  __suggestDisposeFns.push(dispose);
}

/** First geocode match for typed address (no suggestion dropdown). Used for dropoff on “Request Ride”. */
async function geocodeFirstSuggestion(q) {
  const params = new URLSearchParams({ q: String(q || "").trim() });
  if (state.settings?.country) params.set("country", state.settings.country);
  if (state.settings?.province) params.set("province", state.settings.province);
  if (state.settings?.city) params.set("city", state.settings.city);
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
    s = await api(
      `/geocode/google-place?place=${encodeURIComponent(s.googlePlaceResource)}`
    );
  }
  return s;
}

function destroyBookingRouteMap() {
  if (state.bookingMap) {
    try {
      state.bookingMap.remove();
    } catch {
      /* ignore */
    }
    state.bookingMap = null;
  }
}

async function mountBookingRouteMap(mapEl, plat, plng, dlat, dlng) {
  destroyBookingRouteMap();
  if (!mapEl || !window.L) return;
  if (
    !Number.isFinite(plat) ||
    !Number.isFinite(plng) ||
    !Number.isFinite(dlat) ||
    !Number.isFinite(dlng)
  )
    return;

  const map = window.L.map(mapEl).setView([(plat + dlat) / 2, (plng + dlng) / 2], 13);
  window.L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: "© OpenStreetMap",
  }).addTo(map);

  window.L.marker([plat, plng]).addTo(map).bindPopup("Pickup");
  window.L.marker([dlat, dlng]).addTo(map).bindPopup("Dropoff");

  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${plng},${plat};${dlng},${dlat}?overview=full&geometries=geojson`;
    const r = await fetch(url);
    if (r.ok) {
      const j = await r.json();
      const coords = j.routes?.[0]?.geometry?.coordinates;
      if (coords?.length) {
        const latLngs = coords.map(([x, y]) => [y, x]);
        window.L.polyline(latLngs, { color: "#6d5efc", weight: 5, opacity: 0.85 }).addTo(
          map
        );
        map.fitBounds(latLngs, { padding: [24, 24] });
        state.bookingMap = map;
        return;
      }
    }
  } catch {
    /* route preview optional */
  }

  map.fitBounds(
    [
      [plat, plng],
      [dlat, dlng],
    ],
    { padding: [40, 40] }
  );
  state.bookingMap = map;
}

function randomNearCity() {
  const cityLat = 40.7128;
  const cityLng = -74.006;
  return {
    lat: cityLat + (Math.random() - 0.5) * 0.04,
    lng: cityLng + (Math.random() - 0.5) * 0.04,
  };
}

async function loadRides() {
  if (!state.token) return;
  try {
    const res = await api("/rides/mine");
    state.rides = res.rides || [];
    state.activeRide =
      state.rides.find((r) =>
        ["requested", "matched", "accepted", "arriving", "in_progress"].includes(
          r.status
        )
      ) || null;
  } catch {
    // ignore
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
        el("div", { class: "hero-logo-wrap" }, [
          el("img", {
            class: "hero-logo",
            src: "/logos/My%20Ride.png",
            alt: "My Ride",
            loading: "eager",
          }),
        ]),
        el("div", { class: "hero-toptext" }, [
          el("div", { class: "badge", html: "Fast • Safe • Reliable" }),
          el("h1", { class: "h1", html: "My Ride" }),
          el("div", { class: "slogan", html: "Serving you since 1949" }),
          el("p", {
            class: "lead",
            html:
              "Your complete e-hailing web ecosystem...",
          }),
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
              html: "Activate: DESKTOP, TABLET or MOBILE View.",
            }),
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

  const DRAFT_KEY = "myride_booking_draft";
  const readDraft = () => {
    try {
      return JSON.parse(localStorage.getItem(DRAFT_KEY) || "null") || {};
    } catch {
      return {};
    }
  };
  const writeDraft = (patch) => {
    const cur = readDraft();
    localStorage.setItem(DRAFT_KEY, JSON.stringify({ ...cur, ...patch }));
  };

  const draft = readDraft();

  const pickupText = el("input", {
    class: "input",
    placeholder: "Search pickup address or landmark",
  });
  const dropoffText = el("input", {
    class: "input",
    placeholder: "Search dropoff address or landmark",
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
  const payment = el("select", { class: "input" }, [
    el("option", { value: "cash", html: "Cash" }),
    el("option", { value: "card", html: "Card" }),
  ]);
  payment.value = draft.payment_method === "card" ? "card" : "cash";
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
  };

  function safeJsonParse(raw, fallback) {
    try {
      return JSON.parse(raw || "{}");
    } catch {
      return fallback;
    }
  }

  let dropoffManualCoords = false;
  let dropoffResolvedForQuery = null;
  if (
    draft.dropoff_text &&
    draft.dropoff_lat != null &&
    draft.dropoff_lng != null
  ) {
    dropoffResolvedForQuery = String(draft.dropoff_text).trim();
  }

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

  createAddressSuggest({
    textEl: pickupText,
    latEl: pickupLat,
    lngEl: pickupLng,
    componentsEl: pickupComponents,
    addressRole: "pickup",
    focusNextEl: dropoffText,
    onApply: syncDraft,
  });

  createAddressSuggest({
    textEl: dropoffText,
    latEl: dropoffLat,
    lngEl: dropoffLng,
    componentsEl: dropoffComponents,
    addressRole: "dropoff",
    focusNextEl: passengers,
    onApply: () => {
      dropoffResolvedForQuery = String(dropoffText.value || "").trim();
      dropoffManualCoords = false;
      syncDraft();
    },
  });

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
      const raw = await geocodeFirstSuggestion(q);
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
        syncDraft();
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
      syncDraft();
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
    passengers,
    payment,
  ].forEach((n) => n.addEventListener("input", syncDraft));

  payment.addEventListener("change", () => {
    syncDraft();
    if (payment.value === "cash") {
      showPopup("Please pay the driver upon entering the vehicle.");
    }
  });

  const createRide = el(
    "button",
    {
      class: "btn",
      onClick: async () => {
        try {
          await ensureDropoffResolved();
          const vehicle_type = passengersToVehicleType(passengers.value);
          const payment_method = payment.value;
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
          await loadRides();
          state.activeRide = res.ride;
          if (payment_method === "card") {
            try {
              await runStripeRidePayment(res.ride.id);
              return;
            } catch (e) {
              // Dev fallback: simulate payment when Stripe isn't configured.
              try {
                await api("/payments/mock-pay", {
                  method: "POST",
                  body: { ride_id: res.ride.id },
                });
                toast("Payment simulated (dev)", "success");
                await loadRides();
                render();
                return;
              } catch {
                showPopup(
                  "Card payment could not be started. Please check Stripe keys/webhook, or use Cash. (Dev: enable mock payments.)"
                );
                throw e;
              }
            }
          }
          render();
        } catch (e) {
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

  const trackingCard = card("Live Tracking (mock)", [
    active
      ? el("div", { class: "stack" }, [
          el("div", { class: "kv" }, [
            el("div", { class: "k", html: "Ride" }),
            el("div", { class: "v", html: `#${active.id} (${active.status})` }),
          ]),
          el("div", { class: "kv" }, [
            el("div", { class: "k", html: "Fare (est)" }),
            el("div", { class: "v", html: money(active.fare_estimate_cents) }),
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
          active.payment_status === "requires_payment"
            ? el(
                "button",
                {
                  class: "btn",
                  onClick: async () => {
                    try {
                      await runStripeRidePayment(active.id);
                    } catch (e) {
                      // Dev fallback: simulate if Stripe isn't configured
                      try {
                        await api("/payments/mock-pay", {
                          method: "POST",
                          body: { ride_id: active.id },
                        });
                        toast("Payment simulated (dev)", "success");
                        await loadRides();
                        render();
                      } catch {
                        toast(e.data?.error || e.message, "error");
                      }
                    }
                  },
                },
                [document.createTextNode("Pay with Stripe (test)")]
              )
            : null,
          el("div", { class: "muted", html: "Driver sim updates every ~5 seconds." }),
        ])
      : el("div", { class: "muted", html: "No active ride. Request one above." }),
  ]);

  const history = card("Ride History", [
    state.rides.length
      ? el(
          "div",
          { class: "table" },
          state.rides.slice(0, 12).map((r) =>
            el("div", { class: "tr" }, [
              el("div", { class: "td", html: `#${r.id}` }),
              el("div", { class: "td", html: `${r.vehicle_type}` }),
              el("div", { class: "td", html: `${r.status}` }),
              el("div", {
                class: "td right",
                html: money(r.final_fare_cents ?? r.fare_estimate_cents),
              }),
              el(
                "button",
                {
                  class: "btn xs ghost",
                  onClick: async () => {
                    const detail = await api(`/rides/${r.id}`);
                    state.activeRide = detail.ride;
                    toast(`Opened ride #${r.id}`, "info");
                    render();
                  },
                },
                [document.createTextNode("Open")]
              ),
            ])
          )
        )
      : el("div", { class: "muted", html: "No rides yet." }),
  ]);

  const bookingMapEl = el("div", {
    class: "booking-map",
    id: "bookingRouteMap",
    style: "display:none",
  });

  const booking = card("Book My Ride", [
    el("div", { class: "stack" }, [
      el("div", { class: "address-field" }, [
        el("div", { class: "address-field-head" }, [
          el("span", { class: "address-field-label", html: "Pickup location" }),
          el("div", { class: "address-actions" }, [
            usePickupLocationBtn,
            approxPickupIpBtn,
          ]),
        ]),
        pickupText,
        pickupComponents,
      ]),
      el("div", { class: "address-field" }, [
        el("div", { class: "address-field-head" }, [
          el("span", { class: "address-field-label", html: "Dropoff location" }),
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
      ]),
      inputRow("Number of passengers?", passengers),
      computedVehicle,
      inputRow("Payment", payment),
      el("div", { class: "row actions" }, [createRide]),
      el("div", {
        class: "muted",
        html:
          (state.geocode?.provider === "google"
            ? "Address search: Google Places. "
            : "Address search: OpenStreetMap Nominatim. ") +
          "If you finish typing without choosing a suggestion, we resolve dropoff when you tap Request Ride. Matching is mock: nearest online approved driver of same vehicle type.",
      }),
      bookingMapEl,
    ]),
  ]);

  queueMicrotask(() => {
    const plat = Number(pickupLat.value);
    const plng = Number(pickupLng.value);
    const dlat = Number(dropoffLat.value);
    const dlng = Number(dropoffLng.value);
    if (
      Number.isFinite(plat) &&
      Number.isFinite(plng) &&
      Number.isFinite(dlat) &&
      Number.isFinite(dlng) &&
      window.L
    ) {
      bookingMapEl.style.display = "block";
      mountBookingRouteMap(bookingMapEl, plat, plng, dlat, dlng);
    }
  });

  return el("div", { class: "grid-2" }, [booking, trackingCard, history]);
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
            el("div", { class: "k", html: "Fare" }),
            el("div", { class: "v", html: money(active.fare_estimate_cents) }),
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
                  [document.createTextNode("Complete (requires paid)")]
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
  ]);
}

function adminDashboard() {
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
            ]),
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
              el("div", { class: "td right", html: money(r.final_fare_cents ?? r.fare_estimate_cents) }),
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

  const controls = card("Admin Controls", [
    el("div", { class: "row actions wrap" }, [
      usersBtn,
      driversBtn,
      ridesBtn,
      applicationsBtn,
      analyticsBtn,
      settingsBtn,
      seedBtn,
    ]),
    el("div", { class: "muted", html: "Admin endpoints are protected by JWT role=admin." }),
  ]);

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

  const logiclineConfirmCard = card("Logicline QR Login (dev confirm)", [
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
  ]);

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

  return el("div", { class: "grid-2" }, [
    controls,
    logiclineConfirmCard,
    applicationsCard,
    driversCard,
    analyticsCard,
    ridesCard,
    usersCard,
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

function viewAdmin() {
  if (!state.token) {
    const email = el("input", { class: "input", placeholder: "Admin email" });
    const { wrap: passwordWrap, input: password } = passwordField({
      placeholder: "Password",
    });

    const login = el(
      "button",
      {
        class: "btn",
        onClick: async () => {
          try {
            const res = await api("/users/login", {
              method: "POST",
              body: { email: email.value, password: password.value },
            });
            setAuth(res.token, res.user);
            await refreshMe();
            connectSocket();
            toast("Admin logged in", "success");
            render();
          } catch (e) {
            toast(e.data?.error || e.message, "error");
          }
        },
      },
      [document.createTextNode("Login")]
    );

    return card("Admin Login", [
      el("div", { class: "stack" }, [
        inputRow("Email", email),
        inputRow("Password", passwordWrap),
        el("div", { class: "row actions" }, [login]),
        el("div", { class: "muted", html: "Admin is auto-created on server boot if configured in .env." }),
      ]),
    ]);
  }

  if (state.user?.role !== "admin") {
    return card("Wrong role", [
      el("div", { class: "muted", html: `You are logged in as ${state.user?.role}. Logout and login as admin.` }),
    ]);
  }

  return adminDashboard();
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
          : r === "/admin"
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
  else if (r === "/admin") view.append(viewAdmin());
  else view.append(card("Not found", [el("div", { class: "muted", html: "Unknown route." })]));
}

async function boot() {
  initViewportToolbar();

  try {
    state.settings = await api("/settings");
  } catch {
    state.settings = { country: null, currency: "USD" };
  }

  try {
    state.geocode = await api("/geocode/config");
  } catch {
    state.geocode = { provider: "nominatim", googleConfigured: false };
  }

  render();

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

