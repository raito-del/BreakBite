// staff/green.js
// Green Desk panel (staff side): pending submissions, check + approve/reject,
// coin ledger, recent decisions, and the student record window.
// This file is only the staff screen. The Green Points rules (approve, reject,
// wallets) live in ../green-points/green.js and are imported from there.
import {
  collection, getDocs, onSnapshot, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  db, state, $, esc, toast, todayKey, dayOf,
  onLogin, onRender, onAction, onClick, onChange, onEscape, render
} from "./core.js";
import { approveSubmission, rejectSubmission, setChecked } from "../green-points/green.js";

// ---------- start after login ----------
onLogin(function () {
  onSnapshot(query(collection(db, "greenSubmissions"), orderBy("createdAt", "desc"), limit(100)),
    function (snap) {
      state.greenSubs = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      render(); // Green Desk and the green lines on order tokens both depend on this
    },
    function (err) { toast("Could not load the Green Desk."); console.error(err); }
  );
  onSnapshot(collection(db, "wallets"),
    function (snap) {
      state.wallets = {};
      snap.docs.forEach(function (d) { state.wallets[d.id] = d.data(); });
      renderGreen();
    },
    function (err) { console.error(err); }
  );
});

onRender(renderGreen);
onAction("gApprove", function (id) { approveGreen(id); });
onAction("gReject", function (id) { rejectGreen(id); });

// tick "I checked the items" (saved right away, so the Approve button can be enabled)
onChange(function (e) {
  const c = e.target.closest("[data-gcheck]");
  if (!c) return false;
  setChecked(c.dataset.gcheck, c.checked).catch(function (err) {
    toast("Could not save the tick.");
    console.error(err);
  });
  return true;
});

// record window: open from a ledger row, close with X or the background
onClick(function (e) {
  const gr = e.target.closest("[data-greport]");
  if (gr) { openGreenRecord(gr.dataset.greport); return true; }
  if (e.target.closest("[data-gclose]") || e.target === $("green-overlay")) { closeGreenRecord(); return true; }
  return false;
});

onEscape(closeGreenRecord);

// ---------- drawing ----------
function renderGreen() {
  const today = todayKey();
  const pend = state.greenSubs.filter(function (s) { return s.status === "Pending"; });

  $("g-pending").textContent = pend.length;
  $("g-issued").textContent = state.greenSubs
    .filter(function (s) { return s.status === "Approved" && s.day === today; })
    .reduce(function (a, s) { return a + (Number(s.coins) || 0); }, 0);
  $("g-used").textContent = state.orders
    .filter(function (o) { return dayOf(o) === today; })
    .reduce(function (a, o) { return a + (Number(o.coinsUsed) || 0); }, 0);

  $("g-desk").innerHTML = pend.length
    ? pend.map(function (s) {
        return '<div class="gsub">' +
          '<div class="list-row" style="border:0;padding:0"><span><b>' + esc(s.code) + '</b> · Student <b>' + esc(s.sid) + '</b></span>' +
          '<span class="count">' + (s.coins || 0) + ' coins</span></div>' +
          '<div class="muted" style="margin:6px 0">' + (s.items || []).map(function (i) {
            return i.qty + ' × ' + esc(i.name);
          }).join(', ') + '</div>' +
          '<label class="gcheck"><input type="checkbox" data-gcheck="' + esc(s.id) + '"' + (s.checked ? ' checked' : '') + '> I checked the items</label>' +
          '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
            '<button class="small" data-act="gApprove" data-id="' + esc(s.id) + '"' + (s.checked ? '' : ' disabled') + '>Approve</button>' +
            '<button class="ghost small" data-act="gReject" data-id="' + esc(s.id) + '">Reject</button>' +
          '</div></div>';
      }).join("")
    : '<div class="empty">No pending submissions.</div>';

  const ids = Object.keys(state.wallets);
  $("g-ledger").innerHTML = ids.length
    ? ids.map(function (id) {
        const w = state.wallets[id] || {};
        const waiting = pend.filter(function (s) { return s.sid === id; })
          .reduce(function (a, s) { return a + (Number(s.coins) || 0); }, 0);
        return '<tr class="click" data-greport="' + esc(id) + '">' +
          '<td>' + esc(id) + '</td>' +
          '<td>' + (w.balance || 0) + '</td>' +
          '<td>' + (w.issued || 0) + '</td>' +
          '<td>' + (w.redeemed || 0) + '</td>' +
          '<td>' + (waiting ? '+' + waiting : '0') + '</td></tr>';
      }).join("")
    : '<tr><td colspan="5" class="empty">No wallets yet.</td></tr>';

  const log = state.greenSubs.filter(function (s) { return s.status !== "Pending"; }).slice(0, 8);
  $("g-log").innerHTML = log.length
    ? log.map(function (s) {
        return '<div class="list-row"><span><b>' + esc(s.code) + '</b> · ' + esc(s.sid) +
          ' · <span class="badge ' + (s.status === "Approved" ? "green" : "off") + '">' + s.status + '</span></span>' +
          '<span class="price">' + (s.status === "Approved" ? "+" + (s.coins || 0) : "0") + '</span></div>';
      }).join("")
    : 'Nothing yet.';
}

// ---------- approve / reject ----------
async function approveGreen(id) {
  try {
    const coins = await approveSubmission(id);
    toast(coins + " coins added.");
  } catch (err) {
    const msgs = {
      NOT_CHECKED: 'Tick "I checked the items" first.',
      ALREADY_DECIDED: "This submission was already decided.",
      NOT_FOUND: "Submission not found."
    };
    toast(msgs[err.message] || "Could not approve. Try again.");
    console.error(err);
  }
}

async function rejectGreen(id) {
  try {
    await rejectSubmission(id);
    toast("Submission rejected.");
  } catch (err) {
    const msgs = {
      ALREADY_DECIDED: "This submission was already decided.",
      NOT_FOUND: "Submission not found."
    };
    toast(msgs[err.message] || "Could not reject. Try again.");
    console.error(err);
  }
}

// ---------- student record window ----------
async function openGreenRecord(sid) {
  const w = state.wallets[sid] || { balance: 0, issued: 0, redeemed: 0 };
  const subs = state.greenSubs.filter(function (s) { return s.sid === sid; });
  $("green-sheet").innerHTML =
    '<div class="g-head">' +
      '<div><div class="eyebrow">Full record</div><h2>Student ' + esc(sid) + '</h2></div>' +
      '<button class="x" data-gclose aria-label="Close">&times;</button>' +
    '</div>' +
    '<div class="g-stats">' +
      '<div>Balance<b>' + (w.balance || 0) + '</b></div>' +
      '<div>Earned<b>' + (w.issued || 0) + '</b></div>' +
      '<div>Used on orders<b>' + (w.redeemed || 0) + '</b></div>' +
    '</div>' +
    '<h3>Coin history</h3>' +
    '<div class="g-scroll" id="green-hist">Loading...</div>' +
    '<h3 style="margin-top:12px">Submissions</h3>' +
    '<div class="g-scroll">' + (subs.length
      ? subs.map(function (s) {
          return '<div class="list-row"><span><b>' + esc(s.code) + '</b> · ' + esc(s.day || "") +
            '<div class="hint">' + (s.items || []).map(function (i) { return i.qty + ' × ' + esc(i.name); }).join(', ') + '</div></span>' +
            '<span class="badge ' + (s.status === "Approved" ? "green" : "off") + '">' + s.status + '</span></div>';
        }).join("")
      : '<div class="muted">No submissions yet.</div>') + '</div>';
  $("green-overlay").classList.remove("hidden");

  try {
    const snap = await getDocs(query(collection(db, "wallets", sid, "history"), orderBy("at", "desc"), limit(50)));
    $("green-hist").innerHTML = snap.empty
      ? '<div class="muted">No history yet.</div>'
      : snap.docs.map(function (d) {
          const h = d.data();
          const delta = Number(h.delta) || 0;
          return '<div class="list-row"><span>' + esc(h.text || "") + '</span>' +
            '<b class="' + (delta > 0 ? "green" : "") + '">' + (delta > 0 ? "+" : "") + delta + '</b></div>';
        }).join("");
  } catch (err) {
    $("green-hist").innerHTML = '<div class="muted">Could not load the history.</div>';
    console.error(err);
  }
}

function closeGreenRecord() {
  $("green-overlay").classList.add("hidden");
}