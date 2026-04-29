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
};

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

function setAuth(token, user) {
  state.token = token || "";
  state.user = user || null;
  localStorage.setItem("myride_token", state.token);
  localStorage.setItem("myride_user", JSON.stringify(state.user));
  $("#btnLogout").style.display = state.token ? "inline-flex" : "none";
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
  return `$${(Number(cents || 0) / 100).toFixed(2)}`;
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

function selectVehicle(value = "Mini") {
  const s = el("select", { class: "input" }, [
    el("option", { value: "Auto", html: "Auto" }),
    el("option", { value: "Mini", html: "Mini" }),
    el("option", { value: "Sedan", html: "Sedan" }),
    el("option", { value: "Bike", html: "Bike" }),
  ]);
  s.value = value;
  return s;
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
        el("div", { class: "badge", html: "Fast • Safe • Reliable" }),
        el("h1", { class: "h1", html: "My Ride" }),
        el("div", { class: "slogan", html: "Serving you since 1949" }),
        el("p", {
          class: "lead",
          html:
            "A complete e-hailing web ecosystem — all in one site.",
        }),
        el("div", { class: "hero-cta" }, [
          el("a", { class: "btn", href: "#/customer", html: "Book a ride" }),
          el("a", { class: "btn ghost", href: "#/driver", html: "Driver login" }),
          el("a", { class: "btn ghost", href: "#/admin", html: "Admin panel" }),
        ]),
        el("div", { class: "grid-3" }, [
          el("div", { class: "mini" }, [
            el("div", { class: "mini-title", html: "How it works" }),
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
                "Approved drivers, audit events, and payment confirmation via Stripe.",
            }),
          ]),
          el("div", { class: "mini" }, [
            el("div", { class: "mini-title", html: "Web app" }),
            el("div", {
              class: "mini-text",
              html: "Responsive UI for desktop, tablet, and mobile.",
            }),
          ]),
        ]),
      ]),
      el("div", { class: "hero-right" }, [
        card("New Driver Applications", [
          el("div", { class: "stack" }, [
            el("div", { class: "muted", html: "Apply to work with My Ride (demo form; uploads are mock)." }),
            openAppButton,
            el("div", { class: "divider" }),
            el("div", { class: "muted", html: "Contact: support@myride.com (demo)" }),
          ]),
        ]),
      ]),
    ]),
    modalOverlay,
  ]);
}

function authBlock(roleLabel, roleValue) {
  const email = el("input", { class: "input", placeholder: "Email" });
  const password = el("input", {
    class: "input",
    placeholder: "Password (min 8)",
    type: "password",
  });
  const name = el("input", { class: "input", placeholder: "Full name" });

  const vehicle = selectVehicle("Mini");
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

  const fields = [inputRow("Email", email), inputRow("Password", password)];
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
  const pickupText = el("input", { class: "input", placeholder: "Pickup (e.g., Downtown)" });
  const dropoffText = el("input", { class: "input", placeholder: "Dropoff (e.g., Airport)" });
  const vehicle = selectVehicle("Mini");

  const pickup = randomNearCity();
  const dropoff = randomNearCity();

  const pickupLat = el("input", { class: "input", value: pickup.lat.toFixed(6) });
  const pickupLng = el("input", { class: "input", value: pickup.lng.toFixed(6) });
  const dropoffLat = el("input", { class: "input", value: dropoff.lat.toFixed(6) });
  const dropoffLng = el("input", { class: "input", value: dropoff.lng.toFixed(6) });

  const createRide = el(
    "button",
    {
      class: "btn",
      onClick: async () => {
        try {
          const body = {
            pickup_text: pickupText.value || "Pickup",
            pickup_lat: Number(pickupLat.value),
            pickup_lng: Number(pickupLng.value),
            dropoff_text: dropoffText.value || "Dropoff",
            dropoff_lat: Number(dropoffLat.value),
            dropoff_lng: Number(dropoffLng.value),
            vehicle_type: vehicle.value,
          };

          const res = await api("/rides", { method: "POST", body });
          toast(`Ride #${res.ride.id} created`, "success");
          await loadRides();
          state.activeRide = res.ride;
          render();
        } catch (e) {
          toast(e.data?.error || e.message, "error");
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
                      const res = await api("/payments/create-checkout-session", {
                        method: "POST",
                        body: { ride_id: active.id },
                      });
                      window.location.href = res.url;
                    } catch (e) {
                      toast(e.data?.error || e.message, "error");
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

  const booking = card("Book a My Ride", [
    el("div", { class: "stack" }, [
      inputRow("Pickup", pickupText),
      el("div", { class: "grid-2" }, [
        inputRow("Pickup lat", pickupLat),
        inputRow("Pickup lng", pickupLng),
      ]),
      inputRow("Dropoff", dropoffText),
      el("div", { class: "grid-2" }, [
        inputRow("Dropoff lat", dropoffLat),
        inputRow("Dropoff lng", dropoffLng),
      ]),
      inputRow("Vehicle type", vehicle),
      el("div", { class: "row actions" }, [createRide]),
      el("div", {
        class: "muted",
        html: "Matching is mock: nearest online approved driver of same vehicle type.",
      }),
    ]),
  ]);

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

  return el("div", { class: "grid-2" }, [profileCard, requests, activeCard, earnings]);
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
    const password = el("input", { class: "input", placeholder: "Password", type: "password" });

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
        inputRow("Password", password),
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
  $("#apiBase").textContent = API_BASE;
  $("#year").textContent = String(new Date().getFullYear());

  $("#btnLogout").onclick = logout;
  $("#btnLogout").style.display = state.token ? "inline-flex" : "none";

  const view = $("#view");
  view.innerHTML = "";

  const r = route();
  if (r === "/") view.append(viewHome());
  else if (r === "/customer") view.append(viewCustomer());
  else if (r === "/driver") view.append(viewDriver());
  else if (r === "/admin") view.append(viewAdmin());
  else view.append(card("Not found", [el("div", { class: "muted", html: "Unknown route." })]));
}

async function boot() {
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
      await loadRides();
      render();
    } catch {
      // ignore
    }
  }, 3000);
}

boot();

