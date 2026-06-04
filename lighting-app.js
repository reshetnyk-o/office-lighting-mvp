/* ============================================================
   Lighting Control — engine + interactions
   Implements the Task 3 decision logic, audit log, roles,
   persistence. Vanilla JS, no dependencies.
   ============================================================ */
(function () {
  "use strict";

  var DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var LS_KEY = "lightingControl.v2";

  /* ---------- default state ---------- */
  function defaults() {
    return {
      role: "editor",
      zone: "Floor 2 — Open space",
      schedule: { on: "09:00", off: "19:00", days: [1, 2, 3, 4, 5] },
      exceptions: [{ date: "2026-06-13", mode: "skip" }],
      occupancy: { enabled: true, timeout: 15 },
      daylight: { enabled: true, threshold: 400 },
      override: null, // { state:'ON'|'OFF', expiresMin:Number|null, label:String }
      sim: { date: "2026-06-10", minutes: 600, occupied: true, lux: 220 },
      log: []
    };
  }

  var state = load();

  function load() {
    try {
      var raw = localStorage.getItem(LS_KEY);
      if (raw) {
        var parsed = JSON.parse(raw);
        var d = defaults();
        // shallow-merge to tolerate schema additions
        return Object.assign(d, parsed, {
          schedule: Object.assign(d.schedule, parsed.schedule),
          occupancy: Object.assign(d.occupancy, parsed.occupancy),
          daylight: Object.assign(d.daylight, parsed.daylight),
          sim: Object.assign(d.sim, parsed.sim)
        });
      }
    } catch (e) {}
    var fresh = defaults();
    // seed an opening log entry the first time
    fresh.log = [logEntry("Migrated existing 09:00–19:00 schedule as the starting configuration.", "system", "config")];
    return fresh;
  }

  function save() { try { localStorage.setItem(LS_KEY, JSON.stringify(state)); } catch (e) {} }

  /* ---------- helpers ---------- */
  function toMin(hhmm) { var p = hhmm.split(":"); return (+p[0]) * 60 + (+p[1]); }
  function fmtMin(m) {
    m = ((m % 1440) + 1440) % 1440;
    var h = Math.floor(m / 60), mm = m % 60;
    return (h < 10 ? "0" : "") + h + ":" + (mm < 10 ? "0" : "") + mm;
  }
  function dow(dateStr) { return new Date(dateStr + "T00:00:00").getDay(); }
  function user() { return state.role === "editor" ? "You (Manager)" : "Viewer"; }
  function now() {
    return new Date().toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }
  function logEntry(text, who, type) {
    return { ts: now(), text: text, who: who || user(), type: type || "config" };
  }
  function pushLog(text, type) {
    state.log.unshift(logEntry(text, user(), type));
    if (state.log.length > 60) state.log.length = 60;
  }

  /* ---------- the decision engine (mirrors spec §3.2) ---------- */
  function evaluate() {
    var s = state, sim = s.sim;
    var trace = { override: "off", window: "off", occupancy: "off", daylight: "off", on: "off" };
    var result = { state: "OFF", reason: "", trace: trace };

    // exception for the simulated date?
    var exc = s.exceptions.find(function (e) { return e.date === sim.date; });

    // 1 — manual override (highest priority)
    if (s.override) {
      var expired = s.override.expiresMin != null && sim.minutes >= s.override.expiresMin;
      if (!expired) {
        trace.override = "active";
        result.state = s.override.state;
        result.reason = "<b>Manual override</b> active — forced " + s.override.state + " " + s.override.label + ".";
        return result;
      }
    }
    trace.override = "passed";

    // determine scheduled window
    var d = dow(sim.date);
    var activeDay = s.schedule.days.indexOf(d) !== -1;
    var onM = toMin(s.schedule.on), offM = toMin(s.schedule.off);
    var inHours = sim.minutes >= onM && sim.minutes < offM;

    var skipAllDay = exc && exc.mode === "skip";
    var customWindow = exc && exc.mode === "custom";
    if (customWindow) {
      onM = toMin(exc.on); offM = toMin(exc.off);
      inHours = sim.minutes >= onM && sim.minutes < offM;
    }

    var scheduledWindow = inHours && (customWindow || (activeDay && !skipAllDay));

    // 2 — outside window → OFF
    if (!scheduledWindow) {
      trace.window = "fail";
      var why;
      if (skipAllDay) why = "Today is a <b>configured holiday</b> (skip all day).";
      else if (!activeDay && !customWindow) why = "<b>" + DAYS[d] + " is not an active day</b> in the schedule.";
      else why = "Current time is <b>outside the " + fmtMin(onM) + "–" + fmtMin(offM) + " window</b>.";
      result.state = "OFF"; result.reason = why;
      return result;
    }
    trace.window = "active";

    // 3 — occupancy auto-off
    if (s.occupancy.enabled && !sim.occupied) {
      trace.occupancy = "fail";
      result.state = "OFF";
      result.reason = "Inside scheduled hours, but the <b>office is empty</b> past the " + s.occupancy.timeout + "-min timeout — lights auto-off.";
      return result;
    }
    trace.occupancy = s.occupancy.enabled ? "active" : "skip";

    // 4 — daylight suppression
    if (s.daylight.enabled && sim.lux >= s.daylight.threshold) {
      trace.daylight = "fail";
      result.state = "DIM";
      result.reason = "Enough natural light (<b>" + sim.lux + " lux ≥ " + s.daylight.threshold + " lux</b>) — artificial light dimmed.";
      return result;
    }
    trace.daylight = s.daylight.enabled ? "active" : "skip";

    // 5 — scheduled ON
    trace.on = "active";
    result.state = "ON";
    result.reason = "Scheduled hours, office occupied, low daylight — <b>lights on</b>.";
    return result;
  }

  /* ============================================================
     RENDER
     ============================================================ */
  var $ = function (s) { return document.querySelector(s); };
  var lastLit = null;

  function render() {
    document.body.dataset.role = state.role;

    // status
    var r = evaluate();
    var st = $("#status");
    st.dataset.state = r.state;
    var ss = $("#statusState");
    ss.textContent = r.state;
    ss.className = "status-state " + r.state.toLowerCase();
    $("#statusZone").textContent = state.zone;
    $("#statusReason").innerHTML = r.reason;

    // bulb color reflects state
    var bulb = $(".bulb");
    bulb.style.color = r.state === "ON" ? "#f6b73c" : (r.state === "DIM" ? "#c9a24a" : "#5c626d");

    // trace
    document.querySelectorAll(".trace-step").forEach(function (el) {
      var k = el.dataset.rule, v = r.trace[k];
      el.classList.remove("active", "passed");
      if (v === "active") el.classList.add("active");
      else if (v === "passed" || v === "skip") el.classList.add("passed");
      else if (v === "fail") el.classList.add("active"); // the failing check is the deciding one
    });

    // emit a lighting-switch log entry when the resolved state actually changes
    if (lastLit !== null && lastLit !== r.state) {
      state.log.unshift({ ts: now(), who: "System", text: "Lights switched to " + r.state + " — " + r.reason.replace(/<[^>]+>/g, ""), type: "switch" });
      renderLog();
    }
    lastLit = r.state;

    // schedule controls
    $("#onTime").value = state.schedule.on;
    $("#offTime").value = state.schedule.off;
    renderDays();

    // exceptions
    renderExceptions();
    $("#excBadge").textContent = state.exceptions.length;

    // settings
    $("#occEnabled").checked = state.occupancy.enabled;
    $("#occTimeout").value = state.occupancy.timeout;
    $("#occTimeoutVal").textContent = state.occupancy.timeout + " min";
    $("#occTimeoutWrap").style.opacity = state.occupancy.enabled ? "1" : ".4";
    $("#dlEnabled").checked = state.daylight.enabled;
    $("#dlThresh").value = state.daylight.threshold;
    $("#dlThreshVal").textContent = state.daylight.threshold + " lux";
    $("#dlThreshWrap").style.opacity = state.daylight.enabled ? "1" : ".4";

    // override
    renderOverride();

    // sim
    $("#simTimeVal").textContent = fmtMin(state.sim.minutes);
    $("#simLuxVal").textContent = state.sim.lux + " lux";
    $("#simDate").value = state.sim.date;
    $("#simTime").value = state.sim.minutes;
    $("#simLux").value = state.sim.lux;
    $("#simOcc").checked = state.sim.occupied;

    // role switch
    $("#roleEditor").classList.toggle("active", state.role === "editor");
    $("#roleViewer").classList.toggle("active", state.role === "viewer");

    save();
  }

  function renderDays() {
    var row = $("#daysRow");
    if (row.children.length === 0) {
      DAYS.forEach(function (d, i) {
        var b = document.createElement("button");
        b.className = "day-pill"; b.textContent = d.charAt(0); b.title = d; b.dataset.d = i;
        b.addEventListener("click", function () {
          var idx = state.schedule.days.indexOf(i);
          if (idx === -1) state.schedule.days.push(i); else state.schedule.days.splice(idx, 1);
          state.schedule.days.sort();
          render();
        });
        row.appendChild(b);
      });
    }
    Array.prototype.forEach.call(row.children, function (b) {
      b.classList.toggle("on", state.schedule.days.indexOf(+b.dataset.d) !== -1);
    });
  }

  function renderExceptions() {
    var list = $("#excList");
    list.innerHTML = "";
    if (state.exceptions.length === 0) {
      list.innerHTML = '<div class="exc-empty">No exceptions set. The regular schedule runs every active day.</div>';
      return;
    }
    state.exceptions.slice().sort(function (a, b) { return a.date < b.date ? -1 : 1; }).forEach(function (e) {
      var pretty = new Date(e.date + "T00:00:00").toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
      var label = e.mode === "skip" ? '<span class="pill bad" style="margin-left:10px;"><span class="dot bad"></span>Lights off all day</span>'
        : '<span class="pill warn" style="margin-left:10px;"><span class="dot warn"></span>Custom ' + e.on + "–" + e.off + "</span>";
      var item = document.createElement("div");
      item.className = "exc-item";
      item.innerHTML = '<div><span class="ed">' + pretty + "</span>" + label + "</div>";
      var del = document.createElement("button");
      del.className = "btn btn-danger btn-sm editable"; del.textContent = "Remove";
      del.addEventListener("click", function () {
        state.exceptions = state.exceptions.filter(function (x) { return x !== e; });
        pushLog("Removed exception for " + pretty + ".", "config");
        toast("Exception removed"); render();
      });
      item.appendChild(del);
      list.appendChild(item);
    });
  }

  function renderOverride() {
    var ov = state.override;
    // lapse expired override
    if (ov && ov.expiresMin != null && state.sim.minutes >= ov.expiresMin) {
      state.override = null; ov = null;
    }
    $("#ovInactive").style.display = ov ? "none" : "block";
    $("#ovActiveCard").style.display = ov ? "block" : "none";
    if (ov) {
      $("#ovActiveTxt").textContent = "Forced " + ov.state + " " + ov.label;
    }
  }

  function renderLog() {
    var log = $("#log");
    log.innerHTML = "";
    if (state.log.length === 0) { log.innerHTML = '<div class="log-empty">No activity yet.</div>'; return; }
    var icons = {
      config: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#868d99" stroke-width="1.8"><path d="M12 3v3M12 18v3M3 12h3M18 12h3"/><circle cx="12" cy="12" r="4"/></svg>',
      switch: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#46c08a" stroke-width="1.8"><path d="M12 3a7 7 0 0 1 4 12.7V18H8v-2.3A7 7 0 0 1 12 3Z"/><path d="M9 21h6"/></svg>',
      override: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e8b13f" stroke-width="1.8"><path d="M12 2v10M5 7a8 8 0 1 0 14 0"/></svg>',
      alert: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#ef6f63" stroke-width="1.8"><path d="M10.3 4.2 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.2a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/></svg>'
    };
    state.log.forEach(function (e) {
      var item = document.createElement("div");
      item.className = "log-item" + (e.type === "alert" ? " alert" : "");
      item.innerHTML =
        '<div class="log-ico">' + (icons[e.type] || icons.config) + "</div>" +
        '<div class="log-body"><div class="lt">' + e.text + '</div><div class="lm">' + e.who + " · " + e.ts + "</div></div>";
      log.appendChild(item);
    });
  }

  /* ---------- toast ---------- */
  var toastTimer;
  function toast(msg) {
    var t = $("#toast");
    t.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#46c08a" stroke-width="2.4"><path d="M5 13l4 4L19 7" stroke-linecap="round" stroke-linejoin="round"/></svg>' + msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2200);
  }

  /* ============================================================
     EVENTS
     ============================================================ */
  // tabs
  $("#tabs").addEventListener("click", function (e) {
    var tab = e.target.closest(".tab"); if (!tab) return;
    document.querySelectorAll(".tab").forEach(function (t) { t.classList.remove("active"); });
    document.querySelectorAll(".panel").forEach(function (p) { p.classList.remove("active"); });
    tab.classList.add("active");
    document.querySelector('.panel[data-panel="' + tab.dataset.tab + '"]').classList.add("active");
  });

  // role
  $("#roleEditor").addEventListener("click", function () { state.role = "editor"; render(); });
  $("#roleViewer").addEventListener("click", function () { state.role = "viewer"; render(); });

  // zone
  $("#zoneSel").addEventListener("change", function () { state.zone = this.value; render(); });

  // schedule
  $("#saveSchedule").addEventListener("click", function () {
    state.schedule.on = $("#onTime").value;
    state.schedule.off = $("#offTime").value;
    var dayNames = state.schedule.days.map(function (i) { return DAYS[i]; }).join(", ") || "no days";
    pushLog("Updated schedule to " + state.schedule.on + "–" + state.schedule.off + " on " + dayNames + ".", "config");
    $("#schedSaved").classList.add("show");
    setTimeout(function () { $("#schedSaved").classList.remove("show"); }, 2000);
    toast("Schedule saved — live in ~1 min");
    render();
  });
  $("#onTime").addEventListener("input", function () { state.schedule.on = this.value; });
  $("#offTime").addEventListener("input", function () { state.schedule.off = this.value; });
  $("#resetSchedule").addEventListener("click", function () {
    state.schedule = { on: "09:00", off: "19:00", days: [1, 2, 3, 4, 5] };
    pushLog("Reset schedule to default (09:00–19:00, Mon–Fri).", "config");
    toast("Schedule reset"); render();
  });

  // exceptions
  $("#excMode").addEventListener("change", function () {
    $("#excCustomWrap").style.display = this.value === "custom" ? "block" : "none";
  });
  $("#addExc").addEventListener("click", function () {
    var date = $("#excDate").value;
    if (!date) { toast("Pick a date first"); return; }
    if (state.exceptions.some(function (e) { return e.date === date; })) { toast("That date already has an exception"); return; }
    var mode = $("#excMode").value;
    var ex = { date: date, mode: mode };
    if (mode === "custom") { ex.on = $("#excOn").value; ex.off = $("#excOff").value; }
    state.exceptions.push(ex);
    var pretty = new Date(date + "T00:00:00").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    pushLog("Added " + (mode === "skip" ? "skip" : "custom-hours") + " exception for " + pretty + ".", "config");
    toast("Exception added"); render();
  });

  // settings
  $("#occEnabled").addEventListener("change", function () {
    state.occupancy.enabled = this.checked;
    pushLog("Occupancy auto-off turned " + (this.checked ? "on" : "off") + ".", "config");
    render();
  });
  $("#occTimeout").addEventListener("input", function () {
    state.occupancy.timeout = +this.value; $("#occTimeoutVal").textContent = this.value + " min"; render();
  });
  $("#dlEnabled").addEventListener("change", function () {
    state.daylight.enabled = this.checked;
    pushLog("Daylight (natural light) mode turned " + (this.checked ? "on" : "off") + ".", "config");
    render();
  });
  $("#dlThresh").addEventListener("input", function () {
    state.daylight.threshold = +this.value; $("#dlThreshVal").textContent = this.value + " lux"; render();
  });

  // override
  var ovChoice = null;
  function pickOv(st) {
    ovChoice = st;
    $("#ovOn").classList.toggle("sel-on", st === "ON");
    $("#ovOff").classList.toggle("sel-off", st === "OFF");
    $("#applyOv").disabled = false;
  }
  $("#ovOn").addEventListener("click", function () { pickOv("ON"); });
  $("#ovOff").addEventListener("click", function () { pickOv("OFF"); });
  $("#applyOv").addEventListener("click", function () {
    if (!ovChoice) return;
    var dur = $("#ovDur").value, expiresMin = null, label;
    if (dur === "eod") { expiresMin = 1439; label = "until end of day"; }
    else if (dur === "boundary") {
      var onM = toMin(state.schedule.on), offM = toMin(state.schedule.off);
      var next = [onM, offM].filter(function (m) { return m > state.sim.minutes; }).sort(function (a, b) { return a - b; })[0];
      expiresMin = next != null ? next : 1439;
      label = "until " + fmtMin(expiresMin);
    } else {
      expiresMin = state.sim.minutes + (+dur);
      label = "for " + (+dur / 60) + "h (until " + fmtMin(expiresMin) + ")";
    }
    state.override = { state: ovChoice, expiresMin: expiresMin, label: label };
    pushLog("Manual override: forced " + ovChoice + " " + label + ".", "override");
    toast("Override applied");
    ovChoice = null; $("#ovOn").classList.remove("sel-on"); $("#ovOff").classList.remove("sel-off"); $("#applyOv").disabled = true;
    render();
  });
  $("#clearOv").addEventListener("click", function () {
    pushLog("Manual override cleared — control returned to automatic.", "override");
    state.override = null; toast("Override cleared"); render();
  });

  // failure simulation
  $("#simFail").addEventListener("click", function () {
    state.log.unshift({ ts: now(), who: "System", type: "alert", text: "⚠ Lighting command failed — controller for " + state.zone + " did not confirm state change. Alert sent to #facilities (within 5-min SLA)." });
    renderLog(); toast("Failure alert raised");
  });

  // simulation inputs
  $("#simDate").addEventListener("input", function () { state.sim.date = this.value; render(); });
  $("#simTime").addEventListener("input", function () { state.sim.minutes = +this.value; render(); });
  $("#simLux").addEventListener("input", function () { state.sim.lux = +this.value; render(); });
  $("#simOcc").addEventListener("change", function () { state.sim.occupied = this.checked; render(); });

  /* ---------- boot ---------- */
  $("#zoneSel").value = state.zone;
  renderLog();
  render();
})();
