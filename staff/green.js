// staff/green.js
// Green Desk panel (staff side):
//   - Green Points items: add, edit, hide/show, delete (students see only shown items)
//   - Green Points rules: coin value, max coin use %, daily item limit
//   - Pending submissions: check, then approve / reject
//   - Coin ledger, recent decisions, and the student record window
// The Green Points rules (approve, reject, wallets) live in ../green-points/green.js.
import {
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc, getDoc, getDocs,
  onSnapshot, query, orderBy, limit
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  db, state, $, esc, toast, todayKey, dayOf,
  onLogin, onRender, onAction, onClick, onChange, onEscape, render
} from "./core.js";
import { approveSubmission, rejectSubmission, setChecked } from "../green-points/green.js";

const RULE_DEFAULTS = { coinTk: 1, maxPct: 30, dailyCap: 20 };

let greenItems = [];   // catalog: every item, shown or hidden
let itemsBuilt = false;

// ---------- start after login ----------
onLogin(function () {
  buildItemsCard();
  loadRules();

  onSnapshot(query(collection(db, "greenItems"), orderBy("order")),
    function (snap) {
      greenItems = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      renderItems();
    },
    function (err) { toast("Could not load Green Points items."); console.error(err); }
  );

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
onAction("gi-add", function () { addItem(); });
onAction("gi-save", function (id) { saveItem(id); });
onAction("gi-toggle", function (id) { toggleItem(id); });
onAction("gi-del", function (id) { deleteItem(id); });
onAction("gr-save", function () { saveRules(); });

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

// ---------- settings card: items and rules (built once, inside the Green Desk panel) ----------
function buildItemsCard() {
  if (itemsBuilt) return;
  const card = document.createElement("div");
  card.className = "gcard";
  card.id = "gi-card";
  card.innerHTML =
    '<div class="eyebrow">Green Points settings</div>' +
    '<h3>Items students can bring</h3>' +
    '<p class="muted small">Write the full item details in the name. Hidden items do not show on the student page.</p>' +
    '<div class="table-wrap">' +
      '<table>' +
        '<thead><tr><th>Item</th><th style="width:90px">Coins</th><th style="width:110px">Shown</th><th>Actions</th></tr></thead>' +
        '<tbody id="gi-body"></tbody>' +
      '</table>' +
    '</div>' +
    '<h3 style="margin-top:14px">Add an item</h3>' +
    '<div class="form-row">' +
      '<input type="text" id="gi-new-name" placeholder="Item name">' +
      '<input type="number" id="gi-new-coins" min="1" max="50" placeholder="Coins" style="width:90px">' +
      '<button class="good xs" data-act="gi-add">Add item</button>' +
    '</div>' +
    '<h3 style="margin-top:14px">Green Points rules</h3>' +
    '<div class="form-row">' +
      '<span class="small">1 coin = <input type="number" id="gr-tk" min="0.5" step="0.5" style="width:80px"> Tk</span>' +
      '<span class="small">Max coin use <input type="number" id="gr-pct" min="0" max="100" style="width:80px"> %</span>' +
      '<span class="small">Daily item limit <input type="number" id="gr-cap" min="1" max="200" style="width:80px"></span>' +
      '<button class="good xs" data-act="gr-save">Save rules</button>' +
    '</div>';
  $("panel-green").appendChild(card);
  itemsBuilt = true;
}

function renderItems() {
  buildItemsCard();
  $("gi-body").innerHTML = greenItems.length
    ? greenItems.map(function (i) {
        const id = esc(i.id);
        const hidden = i.active === false;
        return '<tr>' +
          '<td><input type="text" data-gi-name="' + id + '" value="' + esc(i.name || "") + '" style="width:100%"></td>' +
          '<td><input type="number" min="1" max="50" data-gi-coins="' + id + '" value="' + (Number(i.coins) || 1) + '" style="width:70px"></td>' +
          '<td><span class="badge ' + (hidden ? "off" : "green") + '">' + (hidden ? "Hidden" : "Shown") + '</span></td>' +
          '<td style="white-space:nowrap">' +
            '<button class="good xs" data-act="gi-save" data-id="' + id + '">Save</button> ' +
            '<button class="ghost xs" data-act="gi-toggle" data-id="' + id + '">' + (hidden ? "Show" : "Hide") + '</button> ' +
            '<button class="danger xs" data-act="gi-del" data-id="' + id + '">Delete</button>' +
          '</td></tr>';
      }).join("")
    : '<tr><td colspan="4" class="empty">No items yet. Add one below.</td></tr>';
}

function checkItemFields(name, coins) {
  if (!name) { toast("Enter an item name."); return false; }
  if (isNaN(coins) || coins < 1 || coins > 50) { toast("Coins must be 1 to 50."); return false; }
  return true;
}

async function addItem() {
  const name = $("gi-new-name").value.trim();
  const coins = parseInt($("gi-new-coins").value, 10);
  if (!checkItemFields(name, coins)) return;
  try {
    await addDoc(collection(db, "greenItems"), {
      name: name,
      coins: coins,
      active: true,
      order: Date.now()
    });
    $("gi-new-name").value = "";
    $("gi-new-coins").value = "";
    toast(name + " added.");
  } catch (err) {
    toast("Could not add the item.");
    console.error(err);
  }
}

async function saveItem(id) {
  const name = document.querySelector('[data-gi-name="' + id + '"]').value.trim();
  const coins = parseInt(document.querySelector('[data-gi-coins="' + id + '"]').value, 10);
  if (!checkItemFields(name, coins)) return;
  try {
    await updateDoc(doc(db, "greenItems", id), { name: name, coins: coins });
    toast("Saved: " + name);
  } catch (err) {
    toast("Could not save the item.");
    console.error(err);
  }
}

async function toggleItem(id) {
  const item = greenItems.find(function (x) { return x.id === id; });
  if (!item) return;
  try {
    await updateDoc(doc(db, "greenItems", id), { active: item.active === false });
  } catch (err) {
    toast("Could not change the item.");
    console.error(err);
  }
}

async function deleteItem(id) {
  const item = greenItems.find(function (x) { return x.id === id; });
  if (!item) return;
  if (!confirm('Delete "' + item.name + '"? Students will no longer see it.')) return;
  try {
    await deleteDoc(doc(db, "greenItems", id));
    toast("Item deleted.");
  } catch (err) {
    toast("Could not delete the item.");
    console.error(err);
  }
}

async function loadRules() {
  try {
    const snap = await getDoc(doc(db, "settings", "green"));
    const r = Object.assign({}, RULE_DEFAULTS, snap.exists() ? snap.data() : {});
    $("gr-tk").value = r.coinTk;
    $("gr-pct").value = r.maxPct;
    $("gr-cap").value = r.dailyCap;
  } catch (err) {
    console.error(err);
  }
}

async function saveRules() {
  const tk = parseFloat($("gr-tk").value);
  const pct = parseInt($("gr-pct").value, 10);
  const cap = parseInt($("gr-cap").value, 10);
  if (isNaN(tk) || tk <= 0) { toast("Coin value must be above 0."); return; }
  if (isNaN(pct) || pct < 0 || pct > 100) { toast("Max coin use must be 0 to 100%."); return; }
  if (isNaN(cap) || cap < 1) { toast("Daily limit must be at least 1."); return; }
  try {
    await setDoc(doc(db, "settings", "green"), { coinTk: tk, maxPct: pct, dailyCap: cap }, { merge: true });
    toast("Green Points rules saved.");
  } catch (err) {
    toast("Could not save the rules.");
    console.error(err);
  }
}

// ---------- drawing: Green Desk ----------
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