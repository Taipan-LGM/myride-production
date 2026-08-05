(function () {
  const queryView = new URLSearchParams(location.search).get('view');
  const pathView = location.pathname.split('/').filter(Boolean)[0];
  const view = ['rider', 'driver', 'admin'].includes(pathView) ? pathView : (queryView || 'rider');
  const role = view === 'admin' ? 'admin' : view === 'driver' ? 'driver' : 'passenger';
  let accessToken = null;
  const icon = (name) => `<i data-lucide="${name}"></i>`;
  const money = (value) => `R${Number(value || 0).toLocaleString('en-ZA', { maximumFractionDigits: 2 })}`;
  const api = async (url, options = {}) => {
    if (!accessToken) {
      const session = await fetch(`/api/v1/auth/demo-session/${role}`, { method: 'POST' });
      if (!session.ok) throw new Error('Sign in is required for this workspace');
      accessToken = (await session.json()).access_token;
    }
    const response = await fetch(url, {
      ...options,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}`, ...(options.headers || {}) },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.detail || 'The ecosystem could not complete that action');
    }
    return response.json();
  };

  function icons() {
    if (window.lucide) window.lucide.createIcons();
  }

  function modeSwitcher() {
    return `<nav class="ecosystem-switcher" aria-label="MyRide ecosystem views">
      <a class="${view === 'rider' ? 'active' : ''}" href="/rider">${icon('map-pin')} Ride</a>
      <a class="${view === 'driver' ? 'active' : ''}" href="/driver">${icon('car-front')} Drive</a>
      <a class="${view === 'admin' ? 'active' : ''}" href="/admin">${icon('brain-circuit')} AI Ops</a>
    </nav>`;
  }

  function appShell(title, subtitle, content) {
    document.body.style.overflow = 'auto';
    document.body.style.height = 'auto';
    document.body.innerHTML = `<div class="eco-app">
      <aside class="eco-rail">
        <a class="eco-brand" href="/rider"><span class="eco-mark">M</span><span>MyRide</span></a>
        <div class="eco-label">Ecosystem</div>
        <nav class="eco-nav">
          <a href="/rider">${icon('map-pin')}<span>Ride</span></a>
          <a class="${view === 'driver' ? 'active' : ''}" href="/driver">${icon('car-front')}<span>Drive</span></a>
          <a class="${view === 'admin' ? 'active' : ''}" href="/admin">${icon('brain-circuit')}<span>AI Ops</span></a>
        </nav>
        <div class="eco-health"><span class="eco-dot"></span>All systems operational<div class="eco-version">AUTONOMY CORE v2.0</div></div>
      </aside>
      <section class="eco-main"><header class="eco-topbar"><div class="eco-title">${title}<small>${subtitle}</small></div><div class="eco-user"><span class="eco-avatar">TM</span> Thandi M.</div></header>${content}</section>
    </div>`;
    addAssistant();
    icons();
  }

  function metric(label, value, trend, iconName) {
    return `<article class="eco-metric"><header><span>${label}</span>${icon(iconName)}</header><div class="eco-value">${value}</div><div class="eco-trend">${trend}</div></article>`;
  }

  function insight(iconName, title, text, kind = '') {
    return `<article class="eco-insight ${kind}"><div class="eco-insight-icon">${icon(iconName)}</div><div><strong>${title}</strong><p>${text}</p></div></article>`;
  }

  function service(name, status) {
    return `<div class="eco-service"><strong>${name}<b>●</b></strong><small>${status}</small></div>`;
  }

  function rideTable(rides) {
    if (!rides.length) return '<div class="eco-empty">No rides yet. Book from the rider view to populate the live ledger.</div>';
    return `<div class="eco-table-wrap"><table class="eco-table"><thead><tr><th>Ride</th><th>Driver</th><th>Status</th><th>Fare</th><th>Safety</th><th>Payment</th></tr></thead><tbody>${rides.map((ride) => `<tr>
      <td>${ride.id}</td><td>${ride.driver_id || 'AI matching'}</td><td><span class="eco-status ${ride.status}">${ride.status}</span></td><td>${money(ride.fare)}</td><td>${Math.round(ride.safety_score * 100)}%</td><td>${ride.payment_status}</td>
    </tr>`).join('')}</tbody></table></div>`;
  }

  function auditTable(events) {
    if (!events.length) return '<div class="eco-empty">No security activity has been recorded.</div>';
    return `<div class="eco-table-wrap"><table class="eco-table"><thead><tr><th>Time</th><th>Action</th><th>Actor</th><th>Target</th><th>Outcome</th></tr></thead><tbody>${events.map((event) => `<tr>
      <td>${new Date(event.created_at).toLocaleString('en-ZA')}</td><td>${event.action}</td><td>${event.actor_id}</td><td>${event.target_id}</td><td><span class="eco-status ${event.outcome === 'success' ? '' : 'cancelled'}">${event.outcome}</span></td>
    </tr>`).join('')}</tbody></table></div>`;
  }

  async function renderAdmin() {
    const [metrics, ridesResult, driversResult, auditResult] = await Promise.all([
      api('/api/v1/admin/metrics'),
      api('/api/v1/admin/rides'),
      api('/api/v1/admin/drivers'),
      api('/api/v1/admin/audit?limit=20'),
    ]);
    const rides = ridesResult.rides;
    const drivers = driversResult.drivers;
    const content = `<main class="eco-content">
      <div class="eco-heading"><div><h1>Autonomous operations</h1><p>AI dispatch, safety, support, and finance in one control plane.</p></div><div class="eco-live"><span class="eco-dot"></span>LIVE ECOSYSTEM</div></div>
      <section class="eco-metrics" id="live-metrics">
        ${metric('Live rides', metrics.live_rides, 'Activity across the network', 'route')}
        ${metric('Available drivers', metrics.available_drivers, `${metrics.active_drivers} verified in fleet`, 'car-front')}
        ${metric('AI resolution', `${metrics.ai_resolution_rate}%`, 'Above autonomy target', 'brain-circuit')}
        ${metric('Revenue today', money(metrics.revenue_today), 'Automated reconciliation', 'landmark')}
      </section>
      <div class="eco-grid">
        <section class="eco-panel"><div class="eco-panel-head"><h2>Johannesburg live network</h2><span>${drivers.length} connected vehicles</span></div><div id="fleet-map"></div></section>
        <section class="eco-panel"><div class="eco-panel-head"><h2>AI decision feed</h2><span>Continuous</span></div><div class="eco-feed">
          ${insight('trending-up', 'Demand predicted in Sandton', `Demand will peak at ${metrics.ai_insights.surge_forecast.peak_time}. Drivers are being pre-positioned.`)}
          ${insight('shield-check', 'Safety monitor clear', `${metrics.fraud_rate}% fraud rate. Active routes remain inside verified corridors.`)}
          ${insight('map-pin', 'Rosebank supply watch', 'Medium driver shortage forecast within 18 minutes.', 'warn')}
          ${insight('wallet-cards', 'Reconciliation healthy', 'Completed rides split platform fees and driver payouts automatically.')}
        </div></section>
      </div>
      <div class="eco-grid">
        <section class="eco-panel"><div class="eco-panel-head"><h2>Ride ledger</h2><span>${rides.length} persisted records</span></div>${rideTable(rides)}</section>
        <section class="eco-panel"><div class="eco-panel-head"><h2>Service fabric</h2><span>Health checks</span></div><div class="eco-services">
          ${service('AI Dispatcher', 'Operational')}${service('Smart Router', 'Operational')}${service('Safety AI', 'Monitoring')}${service('Payments', 'Hybrid mode')}${service('Support AI', '95.4% auto')}${service('WebSockets', 'Streaming')}
        </div></section>
      </div>
      <section class="eco-panel"><div class="eco-panel-head"><h2>Security activity</h2><span>${metrics.audit_events} durable events</span></div>${auditTable(auditResult.events)}</section>
    </main>`;
    appShell('AI operations', 'Autonomous oversight', content);
    initFleetMap(drivers);
    streamMetrics();
  }

  function initFleetMap(drivers) {
    if (!window.L) return;
    const fleetMap = L.map('fleet-map', { zoomControl: false, attributionControl: false }).setView([-26.126, 28.049], 13);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(fleetMap);
    drivers.forEach((driver) => {
      const color = driver.status === 'available' ? '#08784a' : '#f0b849';
      L.circleMarker([driver.lat, driver.lng], { radius: 7, fillColor: color, fillOpacity: 1, color: '#fff', weight: 2 })
        .addTo(fleetMap).bindTooltip(`${driver.name} • ${driver.status}`);
    });
    L.circle([-26.1076, 28.0567], { radius: 1800, color: '#08784a', fillColor: '#b9ef37', fillOpacity: .09, weight: 1 }).addTo(fleetMap);
    setTimeout(() => fleetMap.invalidateSize(), 100);
  }

  function streamMetrics() {
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const socket = new WebSocket(`${protocol}://${location.host}/ws/admin/metrics?token=${encodeURIComponent(accessToken)}`);
    socket.onmessage = (event) => {
      const metrics = JSON.parse(event.data).metrics;
      const values = document.querySelectorAll('#live-metrics .eco-value');
      if (values.length) [metrics.live_rides, metrics.available_drivers, `${metrics.ai_resolution_rate}%`, money(metrics.revenue_today)]
        .forEach((value, index) => { values[index].textContent = value; });
    };
  }

  async function renderDriver() {
    const driversResult = await api('/api/v1/drivers');
    const driver = driversResult.drivers[0];
    const ridesResult = await api(`/api/v1/drivers/${driver.id}/rides`);
    const ride = ridesResult.rides.find((item) => ['assigned', 'arrived', 'started'].includes(item.status));
    const content = `<main class="eco-content">
      <section class="driver-hero"><div><h1>Good day, ${driver.name.split(' ')[0]}</h1><p>The AI is optimizing your route, demand zone, safety, and earnings.</p></div><div class="driver-online">Available for rides <button class="eco-toggle" title="Driver availability"></button></div></section>
      <section class="eco-metrics">
        ${metric('Today', money(driver.earnings_today), 'Instant payout eligible', 'wallet-cards')}
        ${metric('Rating', driver.rating, 'Top 8% of drivers', 'star')}
        ${metric('Acceptance', `${driver.acceptance_rate}%`, 'Fair dispatch priority', 'badge-check')}
        ${metric('Safety score', `${Math.round(driver.safety_score * 100)}%`, 'All checks verified', 'shield-check')}
      </section>
      <div class="driver-grid">
        <section class="eco-panel"><div class="eco-panel-head"><h2>Current assignment</h2><span>${ride ? ride.id : 'Waiting for AI match'}</span></div>${ride ? activeTrip(ride) : '<div class="eco-empty">You are online. AI dispatch is evaluating nearby requests and predicted demand.</div>'}</section>
        <aside><section class="eco-panel earning-card"><span>Projected weekly earnings</span><strong>${money(driver.earnings_today + 2340)}</strong><small>12% above your four-week average</small></section>
          <section class="eco-panel"><div class="eco-panel-head"><h2>AI daily insight</h2>${icon('sparkles')}</div><div class="eco-feed">
            ${insight('clock-3', 'Best next zone', 'Move toward Sandton CBD between 16:30–18:30 for predicted high demand.')}
            ${insight('coffee', 'Fatigue prevention', '4h 12m remain before the recommended rest window.', 'warn')}
            ${insight('leaf', 'Green driving', 'Smooth acceleration improved your efficiency score by 8%.')}
          </div></section>
        </aside>
      </div>
    </main>`;
    appShell('Driver workspace', 'Earnings and trips', content);
    document.querySelector('[data-transition]')?.addEventListener('click', async (event) => {
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await api(`/api/v1/rides/${ride.id}/status`, { method: 'PATCH', body: JSON.stringify({ status: button.dataset.transition }) });
        await renderDriver();
      } catch (error) {
        alert(error.message);
        button.disabled = false;
      }
    });
  }

  function activeTrip(ride) {
    const next = { assigned: 'arrived', arrived: 'started', started: 'completed' }[ride.status];
    const label = { arrived: 'Confirm arrival', started: 'Start trip', completed: 'Complete and reconcile' }[next];
    return `<div class="trip-body"><span class="eco-status">${ride.status}</span><div class="trip-route">
      <div class="trip-stop"><strong>${ride.pickup_address}</strong><small>Passenger pickup</small></div>
      <div class="trip-stop"><strong>${ride.dropoff_address}</strong><small>${ride.distance_km} km • ${ride.duration_minutes} min</small></div>
    </div><div class="trip-actions"><button class="eco-button">${icon('message-square')} Message rider</button><button class="eco-button primary" data-transition="${next}">${icon('navigation')} ${label}</button></div></div>`;
  }

  function addAssistant() {
    document.body.insertAdjacentHTML('beforeend', `<button class="eco-assistant-button" id="eco-ai-open" title="MyRide AI assistant">${icon('sparkles')}</button>
      <aside class="eco-assistant" id="eco-ai"><div class="eco-assistant-head"><div><strong>MyRide AI</strong><small>Autonomous support • Online</small></div><button id="eco-ai-close" title="Close">${icon('x')}</button></div>
      <div class="eco-messages" id="eco-messages"><div class="eco-message">I operate MyRide support. Ask me about fares, cancellations, payments, lost items, or safety.</div></div>
      <form class="eco-assistant-form" id="eco-ai-form"><input id="eco-ai-input" placeholder="Ask MyRide AI..." aria-label="Message MyRide AI"><button title="Send">${icon('send')}</button></form></aside>`);
    const panel = document.getElementById('eco-ai');
    document.getElementById('eco-ai-open').addEventListener('click', () => panel.classList.toggle('open'));
    document.getElementById('eco-ai-close').addEventListener('click', () => panel.classList.remove('open'));
    document.getElementById('eco-ai-form').addEventListener('submit', async (event) => {
      event.preventDefault();
      const input = document.getElementById('eco-ai-input');
      const message = input.value.trim();
      if (!message) return;
      appendMessage(message, true);
      input.value = '';
      try {
        const result = await api('/api/v1/assistant/chat', { method: 'POST', body: JSON.stringify({ rider_id: 'demo-rider', message }) });
        appendMessage(result.message, false);
      } catch (error) {
        appendMessage(error.message, false);
      }
    });
    icons();
  }

  function appendMessage(text, user) {
    const messages = document.getElementById('eco-messages');
    messages.insertAdjacentHTML('beforeend', `<div class="eco-message ${user ? 'user' : ''}">${text}</div>`);
    messages.scrollTop = messages.scrollHeight;
  }

  function enhanceRider() {
    document.body.insertAdjacentHTML('beforeend', modeSwitcher());
    addAssistant();
    icons();
  }

  async function start() {
    try {
      if (view === 'admin') await renderAdmin();
      else if (view === 'driver') await renderDriver();
      else enhanceRider();
    } catch (error) {
      appShell('MyRide ecosystem', 'Connection issue', `<div class="eco-empty">${error.message}</div>`);
    }
    icons();
  }

  start();
})();