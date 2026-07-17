/* My Ride SA — branded hub with role login */
(() => {
  const STORAGE_KEY = "myride_session_v1";
  const PREFS_KEY = "myride_prefs_v1";
  let session = null; // { token, user }
  let maps = { rider: null, driver: null };
  let markers = { pickup: null, dropoff: null, driver: null };
  let routeLine = null;
  let activeTripId = null;
  let lastOffer = null;
  let driverWs = null;
  let supportTripId = "trip-demo-001";
  let selectedRole = "rider";
  let pickupPlace = { lat: -33.9249, lng: 18.4241, label: "Cape Town CBD" };
  let dropoffPlace = { lat: -33.9180, lng: 18.4232, label: "V&A Waterfront" };
  let suggestTimers = { pickup: null, dropoff: null };
  let prefs = { theme: "light", lang: "en" };

  const I18N = {
    en: {
      book_title: "Book a ride",
      book_sub: "Type addresses · OpenStreetMap autofill · live ZAR fare",
      pickup: "Pickup",
      dropoff: "Dropoff",
      pickup_ph: "Type house number + street (OpenStreetMap)",
      dropoff_ph: "Type house number + street (OpenStreetMap)",
      quick_presets: "Quick presets",
      vehicle: "Vehicle",
      settings_title: "Settings",
      settings_sub: "Theme · Language",
      theme: "Theme",
      theme_light: "Light",
      theme_dark: "Dark",
      language: "Language",
      settings_hint: "Choices save on this device.",
      logout: "Log out",
      nav_home: "Home",
      nav_rider: "Book ride",
      nav_channels: "Book via WhatsApp or Phone Call",
      nav_driver: "Drive",
      nav_safety: "Safety · SOS",
      nav_wallet: "Wallet · Places",
      nav_support: "AI Support",
      nav_history: "History",
      nav_admin: "AI Ops",
      nav_settings: "Settings",
      confirm_addr: "Confirm addresses for your driver",
      loc_getting: "Getting your location…",
      loc_ok: "Pickup set to your current location.",
      loc_fail: "GPS unavailable. Type your pickup address below (OpenStreetMap autofill).",
      loc_manual: "Manual address mode — type house number + street.",
    },
    af: {
      book_title: "Bespreek 'n rit",
      book_sub: "Tik adresse · OpenStreetMap outovul · lewendige ZAR-tarief",
      pickup: "Optelpunt",
      dropoff: "Aflaai",
      pickup_ph: "Tik huisnommer + straat (OpenStreetMap)",
      dropoff_ph: "Tik huisnommer + straat (OpenStreetMap)",
      quick_presets: "Kitskeuses",
      vehicle: "Voertuig",
      settings_title: "Instellings",
      settings_sub: "Tema · Taal",
      theme: "Tema",
      theme_light: "Lig",
      theme_dark: "Donker",
      language: "Taal",
      settings_hint: "Keuses word op hierdie toestel gestoor.",
      logout: "Teken uit",
      loc_getting: "Kry jou ligging…",
      loc_ok: "Optelpunt op jou huidige ligging gestel.",
      loc_fail: "GPS nie beskikbaar nie. Tik jou optel-adres hieronder (OpenStreetMap outovul).",
      loc_manual: "Handmatige adresmodus — tik huisnommer + straat.",
      nav_home: "Tuis",
      nav_rider: "Bespreek rit",
      nav_channels: "Bespreek via WhatsApp of Telefoon",
      nav_driver: "Bestuur",
      nav_safety: "Veiligheid · SOS",
      nav_wallet: "Beursie · Plekke",
      nav_support: "KI-ondersteuning",
      nav_history: "Geskiedenis",
      nav_admin: "KI Ops",
      nav_settings: "Instellings",
      confirm_addr: "Bevestig adresse vir jou bestuurder",
    },
  };

  const $ = (sel) => document.querySelector(sel);
  function $$(sel, root) {
    if (root == null) return [...document.querySelectorAll(sel)];
    return [...root.querySelectorAll(sel)];
  }
  const t = (key) => (I18N[prefs.lang] || I18N.en)[key] || I18N.en[key] || key;

  function loadPrefs() {
    try {
      prefs = { theme: "light", lang: "en", ...JSON.parse(localStorage.getItem(PREFS_KEY) || "{}") };
    } catch {
      prefs = { theme: "light", lang: "en" };
    }
    applyPrefs();
  }

  function savePrefs() {
    localStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
  }

  function applyPrefs() {
    const dark = prefs.theme === "dark";
    document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    $$("[data-i18n]").forEach((el) => {
      const key = el.getAttribute("data-i18n");
      if (key && t(key)) el.textContent = t(key);
    });
    $$("[data-i18n-placeholder]").forEach((el) => {
      const key = el.getAttribute("data-i18n-placeholder");
      if (key && t(key)) el.placeholder = t(key);
    });
    $$("#theme-seg .seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.theme === prefs.theme));
    $$("#lang-seg .seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.lang === prefs.lang));
  }

  function loadSession() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveSession(s) {
    session = s;
    if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else localStorage.removeItem(STORAGE_KEY);
  }

  function parseLatLng(value) {
    const [lat, lng] = String(value || "").split(",").map(Number);
    return { lat, lng };
  }

  function setLocStatus(msg, isError = false) {
    const el = $("#loc-status");
    if (!el) return;
    el.hidden = !msg;
    el.textContent = msg || "";
    el.classList.toggle("error", !!isError);
  }

  async function setPickupFromCoords(lat, lng, labelHint) {
    let label = labelHint || `Current location (${lat.toFixed(5)}, ${lng.toFixed(5)})`;
    try {
      const rev = await api(`/geocode/reverse?lat=${lat}&lng=${lng}`);
      if (rev?.label) label = rev.label;
    } catch {
      /* keep hint */
    }
    pickupPlace = { lat, lng, label };
    const input = $("#pickup-input");
    if (input) input.value = label;
    setLocStatus(t("loc_ok"));
    updateRiderMap();
  }

  function useCurrentLocation() {
    setLocStatus(t("loc_getting"));
    const input = $("#pickup-input");
    if (!navigator.geolocation) {
      setLocStatus(t("loc_fail"), true);
      input?.focus();
      // Auto-clear sticky error once rider starts typing
      input?.addEventListener("input", () => setLocStatus(t("loc_manual")), { once: true });
      return;
    }
    const apply = (pos) => {
      setPickupFromCoords(pos.coords.latitude, pos.coords.longitude, "Current location");
    };
    const giveUp = () => {
      setLocStatus(t("loc_fail"), true);
      if (input) {
        input.focus();
        input.select();
        const clearErr = () => setLocStatus("");
        input.addEventListener("input", clearErr, { once: true });
        input.addEventListener("focus", () => setLocStatus(t("loc_manual")), { once: true });
      }
    };
    const fail = () => {
      navigator.geolocation.getCurrentPosition(apply, giveUp, {
        enableHighAccuracy: false,
        timeout: 12000,
        maximumAge: 120000,
      });
    };
    navigator.geolocation.getCurrentPosition(apply, fail, {
      enableHighAccuracy: true,
      timeout: 8000,
      maximumAge: 30000,
    });
  }

  function bindClearOnFocus(inputId, getPlace, setPlace) {
    const input = $(inputId);
    if (!input) return;
    input.addEventListener("focus", () => {
      const place = getPlace();
      const val = input.value.trim();
      // Clear default preset labels so rider can type a new address
      if (!val || val === place?.label || /^(Cape Town CBD|V&A Waterfront|Current location)/i.test(val)) {
        input.dataset.clearedDefault = "1";
        input.value = "";
        setLocStatus("");
      }
    });
    input.addEventListener("blur", () => {
      if (input.dataset.clearedDefault === "1" && !input.value.trim()) {
        const place = getPlace();
        if (place?.label) input.value = place.label;
      }
      delete input.dataset.clearedDefault;
    });
  }

  function on(sel, event, handler) {
    const el = typeof sel === "string" ? $(sel) : sel;
    if (!el) return;
    el.addEventListener(event, handler);
  }

  async function searchPlaces(q) {
    if (!q || q.trim().length < 2) return [];
    const data = await api(`/geocode/search?q=${encodeURIComponent(q.trim())}&limit=6`);
    return data.results || [];
  }

  function extractHouseNumber(text) {
    const m = String(text || "").trim().match(/^(\d+[A-Za-z]?)\b/);
    return m ? m[1] : null;
  }

  function mergePlaceWithTyped(typed, item) {
    const typedHouse = extractHouseNumber(typed);
    let label = item.label || typed || "";
    if (typedHouse && !label.split(",")[0].includes(typedHouse)) {
      label = `${typedHouse} ${label}`;
    }
    // Prefer rider's full typed line when it already includes street number + street
    const typedTrim = String(typed || "").trim();
    if (typedTrim && typedHouse && /\d+[A-Za-z]?\s+\S{2,}/.test(typedTrim)) {
      label = typedTrim;
    }
    return {
      lat: item.lat,
      lng: item.lng,
      label,
      house_number: item.house_number || typedHouse || null,
      road: item.road || null,
      suburb: item.suburb || null,
      city: item.city || null,
    };
  }

  function updateAddressConfirm() {
    const el = $("#addr-confirm");
    if (!el) return;
    el.hidden = false;
    el.innerHTML = `<strong>${t("confirm_addr")}</strong><br/>
      <span class="addr-line">📍 ${pickupPlace.label || "—"}</span><br/>
      <span class="addr-line">🏁 ${dropoffPlace.label || "—"}</span>`;
  }

  function bindAutocomplete(inputId, listId, onPick) {
    const input = $(inputId);
    const list = $(listId);
    if (!input || !list) return;
    const which = inputId.includes("pickup") ? "pickup" : "dropoff";
    input.addEventListener("input", () => {
      // Keep typed value as source of truth — never overwrite while typing
      clearTimeout(suggestTimers[which]);
      const q = input.value;
      if (q.trim().length < 2) {
        list.hidden = true;
        list.innerHTML = "";
        return;
      }
      suggestTimers[which] = setTimeout(async () => {
        try {
          const results = await searchPlaces(q);
          if (!results.length) {
            list.hidden = true;
            list.innerHTML = "";
            return;
          }
          // Show labels but highlight house number when present
          list.innerHTML = results
            .map((r, i) => {
              const shown = mergePlaceWithTyped(q, r).label.replace(/</g, "&lt;");
              return `<li data-i="${i}" role="option">${shown}</li>`;
            })
            .join("");
          list.hidden = false;
          list._results = results;
          list._typed = q;
          $$("li", list).forEach((li) => {
            li.addEventListener("mousedown", (e) => {
              e.preventDefault();
              const item = list._results[Number(li.dataset.i)];
              if (item) onPick(mergePlaceWithTyped(list._typed || input.value, item));
              list.hidden = true;
            });
          });
        } catch (err) {
          setLocStatus(err.message, true);
        }
      }, 320);
    });
    input.addEventListener("blur", () => setTimeout(() => { list.hidden = true; }, 180));
  }

  async function resolveTypedPlace(inputEl, fallbackPlace) {
    const typed = (inputEl?.value || "").trim();
    if (!typed) return fallbackPlace;
    // If typed matches current label, keep coords
    if (fallbackPlace?.label && typed === fallbackPlace.label) return fallbackPlace;
    try {
      const resolved = await api("/geocode/resolve", {
        method: "POST",
        body: JSON.stringify({ query: typed }),
      });
      return mergePlaceWithTyped(typed, resolved);
    } catch {
      // Keep typed label even if resolve fails (driver still sees street number)
      return { ...fallbackPlace, label: typed };
    }
  }

  async function api(path, opts = {}) {
    const headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
    if (session?.token) headers.Authorization = `Bearer ${session.token}`;
    const res = await fetch(path, { ...opts, headers });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    if (!res.ok) {
      const detail = data.detail || text || res.statusText;
      throw new Error(typeof detail === "string" ? detail : JSON.stringify(detail));
    }
    return data;
  }

  function navForRole(role) {
    const all = [
      { id: "home", label: t("nav_home"), roles: ["rider", "driver", "admin"] },
      { id: "rider", label: t("nav_rider"), roles: ["rider", "admin"] },
      { id: "channels", label: t("nav_channels"), roles: ["rider", "driver", "admin"] },
      { id: "driver", label: t("nav_driver"), roles: ["driver", "admin"] },
      { id: "safety", label: t("nav_safety"), roles: ["rider", "driver", "admin"] },
      { id: "wallet", label: t("nav_wallet"), roles: ["rider", "admin"] },
      { id: "support", label: t("nav_support"), roles: ["rider", "driver", "admin"] },
      { id: "history", label: t("nav_history"), roles: ["rider", "driver", "admin"] },
      { id: "admin", label: t("nav_admin"), roles: ["admin"] },
      { id: "settings", label: t("nav_settings"), roles: ["rider", "driver", "admin"] },
    ];
    return all.filter((n) => n.roles.includes(role));
  }

  function renderNav() {
    const role = session?.user?.role || "rider";
    const items = navForRole(role);
    $("#main-nav").innerHTML = items
      .map((n, i) => `<button class="nav${i === 0 ? " active" : ""}" data-view="${n.id}">${n.label}</button>`)
      .join("");
    $$("#main-nav .nav").forEach((b) =>
      b.addEventListener("click", () => showView(b.dataset.view))
    );
    const ctas = [];
    if (role === "rider" || role === "admin") {
      ctas.push(`<button class="btn primary" data-go="rider">Book a ride</button>`);
    }
    if (role === "driver" || role === "admin") {
      ctas.push(`<button class="btn ghost" data-go="driver">Go online</button>`);
    }
    if (role === "admin") {
      ctas.push(`<button class="btn ghost" data-go="admin">Ops dashboard</button>`);
    }
    $("#home-ctas").innerHTML = ctas.join("");
    $$("#home-ctas [data-go]").forEach((b) =>
      b.addEventListener("click", () => showView(b.dataset.go))
    );
  }

  function showApp() {
    $("#login-screen").classList.add("hidden");
    $("#app-shell").classList.remove("hidden");
    $("#user-name").textContent = session.user.name;
    $("#user-role").textContent = session.user.role;
    if (session.user.role === "driver") {
      $("#driver-id").value = session.user.id;
    }
    renderNav();
    showView("home");
    bootStatus();
  }

  function showLogin() {
    $("#login-screen").classList.remove("hidden");
    $("#app-shell").classList.add("hidden");
  }

  function showView(name) {
    const allowed = navForRole(session.user.role).some((n) => n.id === name);
    if (!allowed) name = "home";
    $$(".view").forEach((v) => v.classList.toggle("active", v.id === `view-${name}`));
    $$("#main-nav .nav").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
    if (name === "rider") {
      ensureMap("rider");
      updateRiderMap();
      loadSavedPlaceChips();
    }
    if (name === "driver") ensureMap("driver");
    if (name === "admin") refreshMetrics();
    if (name === "channels") loadChannelInfo();
    if (name === "wallet") refreshWallet();
    if (name === "safety") refreshSafety();
    if (name === "driver") refreshEarnings();
  }

  function ensureMap(kind) {
    const id = kind === "rider" ? "map-rider" : "map-driver";
    if (maps[kind]) {
      setTimeout(() => maps[kind].invalidateSize(), 40);
      return maps[kind];
    }
    const map = L.map(id, { zoomControl: true }).setView([-33.9249, 18.4241], 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap",
      maxZoom: 19,
    }).addTo(map);
    maps[kind] = map;
    return map;
  }

  function updateRiderMap() {
    const map = ensureMap("rider");
    const pickup = pickupPlace;
    const dropoff = dropoffPlace;
    if (!pickup?.lat || !dropoff?.lat) return;
    if (markers.pickup) map.removeLayer(markers.pickup);
    if (markers.dropoff) map.removeLayer(markers.dropoff);
    if (routeLine) map.removeLayer(routeLine);
    markers.pickup = L.circleMarker([pickup.lat, pickup.lng], {
      radius: 10, color: "#FDB813", fillColor: "#FDB813", fillOpacity: 1, weight: 2,
    }).addTo(map).bindPopup(`<strong>Pickup</strong><br/>${pickup.label || ""}`);
    const dropColor = getComputedStyle(document.documentElement).getPropertyValue("--map-pin-drop").trim() || "#333";
    markers.dropoff = L.circleMarker([dropoff.lat, dropoff.lng], {
      radius: 10, color: dropColor, fillColor: dropColor, fillOpacity: 0.95, weight: 2,
    }).addTo(map).bindPopup(`<strong>Dropoff</strong><br/>${dropoff.label || ""}`);
    routeLine = L.polyline(
      [[pickup.lat, pickup.lng], [dropoff.lat, dropoff.lng]],
      { color: "#FDB813", weight: 4, opacity: 0.85, dashArray: "8 10" },
    ).addTo(map);
    map.fitBounds(L.latLngBounds([pickup.lat, pickup.lng], [dropoff.lat, dropoff.lng]).pad(0.35));
    updateAddressConfirm();
  }

  async function bootStatus() {
    try {
      const h = await api("/health");
      $("#home-status").textContent =
        `API ${h.status} · v${h.version} · signed in as ${session.user.role} · stripe=${h.services.stripe}`;
    } catch (e) {
      $("#home-status").textContent = `API offline: ${e.message}`;
    }
  }

  async function doLogin(e) {
    e.preventDefault();
    const err = $("#login-error");
    err.hidden = true;
    try {
      const data = await api("/auth/login", {
        method: "POST",
        body: JSON.stringify({
          identifier: $("#login-id").value.trim(),
          password: $("#login-pass").value,
          role: selectedRole,
        }),
      });
      saveSession({ token: data.access_token, user: data.user });
      showApp();
    } catch (ex) {
      err.hidden = false;
      err.textContent = ex.message;
    }
  }

  function logout() {
    if (driverWs) driverWs.close();
    saveSession(null);
    showLogin();
  }

  async function estimateFare() {
    pickupPlace = await resolveTypedPlace($("#pickup-input"), pickupPlace);
    dropoffPlace = await resolveTypedPlace($("#dropoff-input"), dropoffPlace);
    if ($("#pickup-input")) $("#pickup-input").value = pickupPlace.label;
    if ($("#dropoff-input")) $("#dropoff-input").value = dropoffPlace.label;
    updateRiderMap();
    const pickup = { lat: pickupPlace.lat, lng: pickupPlace.lng };
    const dropoff = { lat: dropoffPlace.lat, lng: dropoffPlace.lng };
    const fare = await api("/fare-estimate", {
      method: "POST",
      body: JSON.stringify({
        pickup, dropoff,
        vehicle_type: $("#vehicle-type").value,
        surge_multiplier: 1,
      }),
    });
    $("#rider-out").textContent = JSON.stringify(fare, null, 2);
  }

  async function bookRide() {
    pickupPlace = await resolveTypedPlace($("#pickup-input"), pickupPlace);
    dropoffPlace = await resolveTypedPlace($("#dropoff-input"), dropoffPlace);
    if ($("#pickup-input")) $("#pickup-input").value = pickupPlace.label;
    if ($("#dropoff-input")) $("#dropoff-input").value = dropoffPlace.label;
    updateRiderMap();
    const pickup = { lat: pickupPlace.lat, lng: pickupPlace.lng };
    const dropoff = { lat: dropoffPlace.lat, lng: dropoffPlace.lng };
    const offer = await api("/ai/book", {
      method: "POST",
      body: JSON.stringify({
        rider_id: session.user.id,
        pickup, dropoff,
        pickup_address: pickupPlace.label,
        dropoff_address: dropoffPlace.label,
        vehicle_type: $("#vehicle-type").value,
        top_n: 3,
        booking_channel: "web",
      }),
    });
    activeTripId = offer.trip_id;
    supportTripId = offer.trip_id || supportTripId;
    $("#rider-out").textContent = JSON.stringify(offer, null, 2);
    if (offer.trip_id) {
      lastOffer = offer;
      renderOffer(offer);
    }
  }

  function renderOffer(offer) {
    const card = $("#offer-card");
    if (!offer?.trip_id) {
      card.className = "offer empty";
      card.textContent = "No active offer.";
      return;
    }
    const fare = offer.fare?.total ?? "?";
    const driver = (offer.drivers && offer.drivers[0]) || {};
    const carbon = offer.carbon?.co2_kg ?? offer.fare?.carbon?.co2_kg;
    card.className = "offer";
    card.innerHTML = `
      <div><strong>New ride offer</strong> · tap Accept</div>
      <div><strong>Trip</strong> ${String(offer.trip_id).slice(0, 8)}…</div>
      <div>Fare <strong>R${fare}</strong> · ETA ${driver.eta_seconds || "—"}s · your cut ~80%</div>
      ${carbon != null ? `<div>~${carbon} kg CO₂e</div>` : ""}
      <div><strong>Pickup</strong> ${offer.pickup_address || "Pickup"}</div>
      <div><strong>Dropoff</strong> ${offer.dropoff_address || "Dropoff"}</div>
    `;
    $("#btn-accept").disabled = false;
    activeTripId = offer.trip_id;
  }

  async function goOnline(online) {
    const driverId = $("#driver-id").value.trim() || session.user.id;
    const loc = { lat: pickupPlace.lat + 0.001, lng: pickupPlace.lng + 0.001 };
    const data = await api("/driver/update-availability", {
      method: "POST",
      body: JSON.stringify({ driver_id: driverId, is_online: online, location: loc }),
    });
    ensureMap("driver");
    if (markers.driver) maps.driver.removeLayer(markers.driver);
    markers.driver = L.circleMarker([loc.lat, loc.lng], {
      radius: 10, color: "#FDB813", fillColor: "#FDB813", fillOpacity: 1,
    }).addTo(maps.driver);
    maps.driver.setView([loc.lat, loc.lng], 14);
    $("#driver-out").textContent = JSON.stringify(data, null, 2);
  }

  function listenOffers() {
    const driverId = $("#driver-id").value.trim() || session.user.id;
    if (driverWs) driverWs.close();
    const proto = location.protocol === "https:" ? "wss" : "ws";
    driverWs = new WebSocket(`${proto}://${location.host}/ws/driver-requests/${driverId}`);
    driverWs.onopen = () => {
      $("#driver-out").textContent = `Listening for AI ride offers… (${driverId})`;
    };
    driverWs.onmessage = (ev) => {
      const msg = JSON.parse(ev.data);
      $("#driver-out").textContent = JSON.stringify(msg, null, 2);
      if (["ride_offer", "driver_request"].includes(msg.event) || msg.type === "ride_offer") {
        const data = msg.data || {};
        lastOffer = {
          trip_id: data.trip_id,
          fare: data.fare,
          pickup_address: typeof data.pickup === "string" ? data.pickup : "Pickup",
          dropoff_address: typeof data.dropoff === "string" ? data.dropoff : "Dropoff",
          drivers: data.drivers || [{ eta_seconds: data.eta_seconds }],
        };
        renderOffer(lastOffer);
      }
    };
  }

  async function acceptRide() {
    if (!activeTripId) return;
    const driverId = $("#driver-id").value.trim() || session.user.id;
    const trip = await api(`/accept-ride/${activeTripId}`, {
      method: "POST",
      body: JSON.stringify({ driver_id: driverId }),
    });
    $("#driver-out").textContent = JSON.stringify(trip, null, 2);
    $("#btn-arrived").disabled = false;
    $("#btn-start").disabled = false;
    $("#btn-complete").disabled = false;
  }

  async function tripAction(path) {
    if (!activeTripId) return;
    const trip = await api(`/${path}/${activeTripId}`, { method: "POST" });
    $("#driver-out").textContent = JSON.stringify(trip, null, 2);
    if (path === "complete-ride") {
      refreshEarnings().catch(() => {});
    }
  }

  async function loadSavedPlaceChips() {
    const box = $("#saved-place-chips");
    if (!box || !session) return;
    try {
      const data = await api("/places");
      const places = data.places || [];
      if (!places.length) {
        box.hidden = true;
        box.innerHTML = "";
        return;
      }
      box.hidden = false;
      box.innerHTML = places
        .map(
          (p) =>
            `<button type="button" class="chip" data-kind="${p.kind}" data-lat="${p.lat}" data-lng="${p.lng}" data-label="${String(p.label).replace(/"/g, "&quot;")}">${p.kind === "home" ? "🏠" : p.kind === "work" ? "💼" : "📌"} ${p.label}</button>`
        )
        .join("");
      $$(".chip", box).forEach((btn) => {
        btn.addEventListener("click", () => {
          const place = {
            lat: Number(btn.dataset.lat),
            lng: Number(btn.dataset.lng),
            label: btn.dataset.label,
          };
          if (btn.dataset.kind === "work") {
            dropoffPlace = place;
            if ($("#dropoff-input")) $("#dropoff-input").value = place.label;
          } else {
            pickupPlace = place;
            if ($("#pickup-input")) $("#pickup-input").value = place.label;
            setLocStatus("");
          }
          updateRiderMap();
        });
      });
    } catch {
      box.hidden = true;
    }
  }

  async function refreshWallet() {
    try {
      const [w, loy, places] = await Promise.all([
        api("/wallet"),
        api("/loyalty"),
        api("/places"),
      ]);
      $("#wallet-balance").textContent = `R${Number(w.balance_zar).toFixed(2)} available`;
      const next = loy.next_tier_points != null ? ` · next tier at ${loy.next_tier_points} pts` : "";
      $("#loyalty-summary").textContent =
        `${loy.tier.toUpperCase()} · ${loy.points} pts · ${loy.trips_completed} trips${next}`;
      $("#places-out").textContent = JSON.stringify(places.places || [], null, 2);
      $("#wallet-out").textContent = JSON.stringify({ wallet: w, loyalty: loy }, null, 2);
    } catch (e) {
      $("#wallet-out").textContent = e.message;
    }
  }

  async function refreshSafety() {
    try {
      const info = await fetch("/safety/emergency").then((r) => r.json());
      $("#safety-out").textContent = JSON.stringify(info, null, 2);
      if (activeTripId && $("#sos-trip-id")) $("#sos-trip-id").value = activeTripId;
    } catch (e) {
      $("#safety-out").textContent = e.message;
    }
  }

  async function triggerSos() {
    const body = {
      trip_id: ($("#sos-trip-id")?.value || activeTripId || "").trim() || null,
      note: ($("#sos-note")?.value || "").trim() || null,
      lat: pickupPlace?.lat,
      lng: pickupPlace?.lng,
    };
    const data = await api("/safety/sos", { method: "POST", body: JSON.stringify(body) });
    $("#safety-out").textContent = JSON.stringify(data, null, 2);
  }

  async function shareLiveTrip() {
    const tripId = ($("#sos-trip-id")?.value || activeTripId || "").trim();
    if (!tripId) {
      $("#safety-out").textContent = "Book a ride first, then share the live trip.";
      return;
    }
    const data = await api("/safety/share", {
      method: "POST",
      body: JSON.stringify({ trip_id: tripId }),
    });
    const url = `${location.origin}${data.path}`;
    $("#safety-out").textContent = JSON.stringify({ ...data, url }, null, 2);
  }

  async function refreshEarnings() {
    if (!session || (session.user.role !== "driver" && session.user.role !== "admin")) return;
    try {
      const id = ($("#driver-id")?.value || session.user.id).trim();
      const path = session.user.role === "admin" && id !== session.user.id
        ? `/driver/earnings/${id}`
        : "/driver/earnings";
      const data = await api(path);
      $("#earnings-summary").textContent =
        `Today R${Number(data.today_zar).toFixed(2)} · Total R${Number(data.total_zar).toFixed(2)} · ${data.trips} trips (80% driver share)`;
      if ($("#driver-out") && data.recent?.length) {
        /* keep existing driver-out unless empty-ish */
      }
    } catch (e) {
      $("#earnings-summary").textContent = e.message;
    }
  }

  async function savePlaceKind(kind) {
    const place = kind === "work" ? dropoffPlace : pickupPlace;
    if (!place?.lat) throw new Error("Set pickup/dropoff on Book ride first");
    const data = await api("/places", {
      method: "POST",
      body: JSON.stringify({
        kind,
        label: place.label || kind,
        lat: place.lat,
        lng: place.lng,
      }),
    });
    $("#places-out").textContent = JSON.stringify(data.places || [], null, 2);
    $("#wallet-out").textContent = JSON.stringify(data, null, 2);
  }

  function addBubble(role, text, meta = "") {
    const el = document.createElement("div");
    el.className = `bubble ${role}`;
    el.innerHTML = `${text}${meta ? `<span class="meta">${meta}</span>` : ""}`;
    $("#chat-log").appendChild(el);
    $("#chat-log").scrollTop = $("#chat-log").scrollHeight;
  }

  async function askSupport(query) {
    addBubble("user", query);
    const result = await api("/ai/support", {
      method: "POST",
      body: JSON.stringify({
        user_id: session.user.id,
        query,
        channel: "web",
        context: {
          trip_id: supportTripId || activeTripId || "trip-demo-001",
          driver_id: "driver-demo-001",
          status: "completed",
          total_paid: 120,
        },
      }),
    });
    addBubble("ai", result.message || JSON.stringify(result), `${result.category} · ${result.action}`);
  }

  async function refreshMetrics() {
    const m = await api("/admin/metrics");
    const cards = [
      ["Live rides", m.live_rides],
      ["Active drivers", m.active_drivers],
      ["AI resolution", `${m.ai_resolution_rate}%`],
      ["Revenue", `R${(m.revenue_today_zar || 0).toFixed(2)}`],
      ["Avg fare", `R${(m.avg_fare_zar || 0).toFixed(2)}`],
      ["Completed", m.completed_rides],
    ];
    $("#metrics-cards").innerHTML = cards
      .map(([k, v]) => `<div class="metric"><div class="k">${k}</div><div class="v">${v}</div></div>`)
      .join("");
    $("#admin-out").textContent = JSON.stringify(m, null, 2);
  }

  // Role tabs
  $$(".role-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      selectedRole = tab.dataset.role;
      $$(".role-tab").forEach((t) => t.classList.toggle("active", t === tab));
      const presets = {
        rider: ["rider@myride.co.za", "ride123"],
        driver: ["driver@myride.co.za", "drive123"],
        admin: ["admin@myride.co.za", "admin123"],
      };
      const [id, pw] = presets[selectedRole];
      $("#login-id").value = id;
      $("#login-pass").value = pw;
    });
  });

  loadPrefs();
  if ($("#pickup-input")) $("#pickup-input").value = pickupPlace.label;
  if ($("#dropoff-input")) $("#dropoff-input").value = dropoffPlace.label;

  function rememberPlace(item) {
    try {
      const key = "myride_recent_places";
      const prev = JSON.parse(localStorage.getItem(key) || "[]");
      const next = [item, ...prev.filter((p) => p.label !== item.label)].slice(0, 8);
      localStorage.setItem(key, JSON.stringify(next));
    } catch { /* ignore */ }
  }

  bindAutocomplete("#pickup-input", "#pickup-suggest", (item) => {
    pickupPlace = item;
    $("#pickup-input").value = item.label;
    rememberPlace(item);
    setLocStatus("");
    updateRiderMap();
  });
  bindAutocomplete("#dropoff-input", "#dropoff-suggest", (item) => {
    dropoffPlace = item;
    $("#dropoff-input").value = item.label;
    rememberPlace(item);
    updateRiderMap();
  });
  bindClearOnFocus("#pickup-input", () => pickupPlace, (p) => { pickupPlace = p; });
  bindClearOnFocus("#dropoff-input", () => dropoffPlace, (p) => { dropoffPlace = p; });

  on("#login-form", "submit", doLogin);
  on("#btn-logout", "click", logout);
  on("#btn-settings-nav", "click", () => showView("settings"));
  on("#theme-seg", "click", (e) => {
    const btn = e.target.closest("[data-theme]");
    if (!btn) return;
    prefs.theme = btn.dataset.theme;
    savePrefs();
    applyPrefs();
    updateRiderMap();
  });
  on("#lang-seg", "click", (e) => {
    const btn = e.target.closest("[data-lang]");
    if (!btn) return;
    prefs.lang = btn.dataset.lang;
    savePrefs();
    applyPrefs();
    if (session) renderNav();
  });
  on("#pickup-preset", "change", () => {
    const p = parseLatLng($("#pickup-preset").value);
    pickupPlace = { ...p, label: $("#pickup-preset").selectedOptions[0].text };
    $("#pickup-input").value = pickupPlace.label;
    updateRiderMap();
  });
  on("#dropoff-preset", "change", () => {
    const p = parseLatLng($("#dropoff-preset").value);
    dropoffPlace = { ...p, label: $("#dropoff-preset").selectedOptions[0].text };
    $("#dropoff-input").value = dropoffPlace.label;
    updateRiderMap();
  });
  on("#btn-current-location", "click", (e) => {
    e.preventDefault();
    useCurrentLocation();
  });
  // Event delegation — works even if cards re-render
  document.addEventListener("click", (e) => {
    const go = e.target.closest("[data-go]");
    if (!go || !session) return;
    const view = go.dataset.go;
    if (view) {
      e.preventDefault();
      showView(view);
    }
  });
  on("#btn-estimate", "click", () => estimateFare().catch((e) => {
    $("#rider-out").textContent = e.message;
  }));
  on("#btn-book", "click", () => bookRide().catch((e) => {
    $("#rider-out").textContent = e.message;
  }));
  async function loadChannelInfo() {
    try {
      const info = await api("/channels");
      const phone = info.phone?.number || "Configure TWILIO_PHONE_NUMBER";
      const wa = info.whatsapp?.number || "Configure TWILIO_WHATSAPP_NUMBER";
      $("#channel-info").innerHTML = `
        <strong>📱 App</strong> — Flutter Rider / Driver<br/>
        <strong>💻 Website</strong> — <a href="/">${location.origin}/</a><br/>
        <strong>📞 Phone</strong> — <a href="tel:${phone}">${phone}</a> ${info.phone?.status || ""}<br/>
        <strong>💬 WhatsApp</strong> — ${wa} ${info.whatsapp?.status || ""}<br/>
        <span style="color:var(--muted);font-size:.85rem">Dev: simulate below without Twilio keys.</span>
      `;
    } catch (e) {
      $("#channel-info").textContent = e.message;
    }
  }
  on("#btn-sim-voice", "click", () => {
    const text = $("#sim-voice-text").value.trim();
    api("/channels/voice/simulate", {
      method: "POST",
      body: JSON.stringify({ text, from_number: session?.user?.phone || "+27821234567" }),
    })
      .then((d) => { $("#channels-out").textContent = JSON.stringify(d, null, 2); })
      .catch((e) => { $("#channels-out").textContent = e.message; });
  });
  on("#btn-sim-wa", "click", () => {
    const text = $("#sim-wa-text").value.trim();
    api("/channels/whatsapp/simulate", {
      method: "POST",
      body: JSON.stringify({ text, from_number: session?.user?.phone || "+27821234567" }),
    })
      .then((d) => { $("#channels-out").textContent = JSON.stringify(d, null, 2); })
      .catch((e) => { $("#channels-out").textContent = e.message; });
  });
  on("#btn-schedule", "click", () => {
    const when = $("#schedule-for")?.value;
    if (!when) {
      $("#rider-out").textContent = "Pick a schedule time first.";
      $("#schedule-for")?.focus();
      return;
    }
    api("/rides/schedule", {
      method: "POST",
      body: JSON.stringify({
        rider_id: session.user.id,
        pickup: { lat: pickupPlace.lat, lng: pickupPlace.lng },
        dropoff: { lat: dropoffPlace.lat, lng: dropoffPlace.lng },
        pickup_address: pickupPlace.label,
        dropoff_address: dropoffPlace.label,
        scheduled_for: new Date(when).toISOString(),
        vehicle_type: $("#vehicle-type").value,
      }),
    })
      .then((d) => { $("#rider-out").textContent = JSON.stringify(d, null, 2); })
      .catch((e) => { $("#rider-out").textContent = e.message; });
  });
  on("#btn-rate", "click", () => {
    if (!activeTripId) {
      $("#rider-out").textContent = "Book a trip first, then rate it.";
      return;
    }
    const rating = Number($("#rate-stars")?.value || 5);
    api("/rides/rate", {
      method: "POST",
      body: JSON.stringify({
        trip_id: activeTripId,
        rating,
        comment: "Hub rating",
        from_role: session.user.role === "driver" ? "driver" : "rider",
      }),
    })
      .then((d) => { $("#rider-out").textContent = JSON.stringify(d, null, 2); })
      .catch((e) => { $("#rider-out").textContent = e.message; });
  });
  on("#btn-online", "click", () => goOnline(true).catch((e) => {
    $("#driver-out").textContent = e.message;
  }));
  on("#btn-offline", "click", () => goOnline(false).catch((e) => {
    $("#driver-out").textContent = e.message;
  }));
  on("#btn-listen", "click", listenOffers);
  on("#btn-accept", "click", () => acceptRide().catch((e) => {
    $("#driver-out").textContent = e.message;
  }));
  on("#btn-arrived", "click", () => tripAction("driver-arrived").catch((e) => {
    $("#driver-out").textContent = e.message;
  }));
  on("#btn-start", "click", () => tripAction("start-ride").catch((e) => {
    $("#driver-out").textContent = e.message;
  }));
  on("#btn-complete", "click", () => tripAction("complete-ride").catch((e) => {
    $("#driver-out").textContent = e.message;
  }));
  on("#btn-earnings", "click", () => refreshEarnings().catch((e) => {
    $("#earnings-summary").textContent = e.message;
  }));
  on("#btn-sos", "click", () => triggerSos().catch((e) => {
    $("#safety-out").textContent = e.message;
  }));
  on("#btn-share-trip", "click", () => shareLiveTrip().catch((e) => {
    $("#safety-out").textContent = e.message;
  }));
  on("#btn-wallet-refresh", "click", () => refreshWallet().catch((e) => {
    $("#wallet-out").textContent = e.message;
  }));
  on("#btn-topup", "click", () => {
    api("/wallet/top-up", {
      method: "POST",
      body: JSON.stringify({ amount_cents: 10000 }),
    })
      .then(() => refreshWallet())
      .catch((e) => { $("#wallet-out").textContent = e.message; });
  });
  on("#btn-save-home", "click", () => savePlaceKind("home").catch((e) => {
    $("#wallet-out").textContent = e.message;
  }));
  on("#btn-save-work", "click", () => savePlaceKind("work").catch((e) => {
    $("#wallet-out").textContent = e.message;
  }));
  on("#btn-promo", "click", () => {
    const code = ($("#promo-code")?.value || "").trim();
    if (!code) {
      $("#promo-out").textContent = "Enter a promo code (e.g. MYRIDE50).";
      return;
    }
    api("/promos/redeem", { method: "POST", body: JSON.stringify({ code }) })
      .then((d) => {
        $("#promo-out").textContent = JSON.stringify(d, null, 2);
        refreshWallet().catch(() => {});
      })
      .catch((e) => { $("#promo-out").textContent = e.message; });
  });
  on("#btn-referral", "click", () => {
    api("/referrals/me")
      .then((d) => { $("#promo-out").textContent = JSON.stringify(d, null, 2); })
      .catch((e) => { $("#promo-out").textContent = e.message; });
  });
  on("#support-form", "submit", (e) => {
    e.preventDefault();
    const q = $("#support-q").value.trim();
    if (!q) return;
    $("#support-q").value = "";
    askSupport(q).catch((err) => addBubble("ai", err.message));
  });
  $$(".chip").forEach((c) => on(c, "click", () => {
    askSupport(c.dataset.q).catch((err) => addBubble("ai", err.message));
  }));

  on("#btn-history", "click", () => {
    api("/rides/history")
      .then((d) => { $("#history-out").textContent = JSON.stringify(d, null, 2); })
      .catch((e) => { $("#history-out").textContent = e.message; });
  });
  on("#btn-suggestions", "click", () => {
    api("/ai/suggestions")
      .then((d) => { $("#history-out").textContent = JSON.stringify(d, null, 2); })
      .catch((e) => { $("#history-out").textContent = e.message; });
  });
  on("#btn-insights", "click", () => {
    const id = session.user.role === "driver" ? session.user.id : "driver-demo-001";
    api(`/ai/driver-insights/${id}`)
      .then((d) => { $("#history-out").textContent = JSON.stringify(d, null, 2); })
      .catch((e) => { $("#history-out").textContent = e.message; });
  });
  on("#btn-refresh-metrics", "click", () => {
    refreshMetrics().catch((e) => { $("#admin-out").textContent = e.message; });
  });
  on("#btn-reconcile", "click", () => {
    if (!activeTripId) {
      $("#admin-out").textContent = "No trip_id — book + complete a ride first.";
      return;
    }
    api(`/payments/reconcile/${activeTripId}`, { method: "POST" })
      .then((d) => { $("#admin-out").textContent = JSON.stringify(d, null, 2); })
      .catch((e) => { $("#admin-out").textContent = e.message; });
  });
  on("#btn-ledger", "click", () => {
    api("/payments/ledger")
      .then((d) => { $("#admin-out").textContent = JSON.stringify(d, null, 2); })
      .catch((e) => { $("#admin-out").textContent = e.message; });
  });
  on("#btn-ml-status", "click", () => {
    api("/ai/ml/status")
      .then((d) => { $("#admin-out").textContent = JSON.stringify(d, null, 2); })
      .catch((e) => { $("#admin-out").textContent = e.message; });
  });
  on("#btn-ml-train", "click", () => {
    api("/ai/ml/train", { method: "POST" })
      .then((d) => { $("#admin-out").textContent = JSON.stringify(d, null, 2); })
      .catch((e) => { $("#admin-out").textContent = e.message; });
  });

  // Prefill rider demo
  if ($("#login-id")) $("#login-id").value = "rider@myride.co.za";
  if ($("#login-pass")) $("#login-pass").value = "ride123";

  session = loadSession();
  if (session?.token && session?.user) {
    api("/auth/me")
      .then((user) => {
        session.user = user;
        saveSession(session);
        showApp();
      })
      .catch(() => {
        saveSession(null);
        showLogin();
      });
  } else {
    showLogin();
  }

  setInterval(() => {
    if (
      session?.user?.role === "admin" &&
      $("#view-admin")?.classList.contains("active")
    ) {
      refreshMetrics().catch(() => {});
    }
  }, 8000);
})();
