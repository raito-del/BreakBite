// staff/orders.js
// Orders panel: live board (Received / Preparing / Ready), queue stats,
// completed list, End of day button, and the Past daily reports (archive + detail popup).
// Plugs into staff/core.js. Reads state.orders, state.reports and state.greenSubs.
import {
  collection, doc, updateDoc, setDoc, addDoc, getDocs, onSnapshot,
  query, orderBy, limit, writeBatch, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  db, state, $, esc, toast, todayKey, timeText, itemsText, studentIdHtml,
  onLogin, onRender, onAction, onClick, onEscape, render
} from "./core.js";

const STATUS_FLOW = ["Received", "Preparing", "Ready", "Done"];
const NEXT_LABEL = { Received: "Start preparing", Preparing: "Mark ready", Ready: "Mark collected" };

// ---------- start after login ----------
onLogin(function () {
  watchReports();
  onSnapshot(query(collection(db, "orders"), orderBy("createdAt", "desc"), limit(50)),
    function (snap) {
      state.orders = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      render(); // other panels (Green Desk) also depend on orders
    },
    function (err) { toast("Could not load orders."); console.error(err); }
  );
});

onRender(renderOrders);
onAction("advance", function (id) { advanceOrder(id); });
$("eod-btn").addEventListener("click", endOfDay);

// ---------- helpers ----------
function setBar(id, pct) {
  $(id).style.width = Math.max(0, Math.min(100, pct)) + "%";
}

// small green line on an order: coins used, and the G-code status
export function greenLineHtml(o) {
  const used = Number(o.coinsUsed) || 0;
  if (!used && !o.greenCode) return "";
  const sub = o.greenCode ? state.greenSubs.find(function (x) { return x.code === o.greenCode; }) : null;
  let add = "";
  if (o.greenCode) {
    if (!sub) add = esc(o.greenCode);
    else if (sub.status === "Approved") add = esc(o.greenCode) + ": +" + sub.coins + " added";
    else if (sub.status === "Rejected") add = esc(o.greenCode) + ": rejected";
    else add = esc(o.greenCode) + ": +" + sub.coins + " waiting";
  }
  const parts = [used ? "Used <b>" + used + "</b> Green coins" : "", add].filter(Boolean).join(" · ");
  const cls = sub && sub.status === "Pending" ? " pending" : "";
  return '<div class="gline' + cls + '">Green Points · ' + parts + '</div>';
}

// ---------- drawing ----------
function renderOrders() {
  const orders = state.orders;
  // Cancelled orders are not active: they leave the board, queue and waiting time
  const active = orders.filter(function (o) { return o.status !== "Done" && o.status !== "Cancelled"; });
  const queue = active.filter(function (o) { return o.status === "Received" || o.status === "Preparing"; }).length;
  const ready = active.filter(function (o) { return o.status === "Ready"; }).length;
  const wait = 3 + queue * 2;

  $("queue-count").textContent = queue;
  $("wait-time").textContent = wait + " min";
  $("ready-count").textContent = ready;
  $("wait-stat").classList.toggle("hot", queue >= 8);
  setBar("queue-bar", queue * 10);
  setBar("wait-bar", wait * 4);
  setBar("ready-bar", active.length ? Math.round(ready / active.length * 100) : 0);

  ["Received", "Preparing", "Ready"].forEach(function (s) {
    const list = active.filter(function (o) { return o.status === s; });
    $("cnt-" + s).textContent = list.length;
    $("col-" + s).innerHTML = list.length
      ? list.map(ticketHtml).join("")
      : '<div class="empty">No ' + s.toLowerCase() + ' orders.</div>';
  });

  // Completed list: Done and Cancelled, with the student ID on each row
  const done = orders
    .filter(function (o) { return o.status === "Done" || o.status === "Cancelled"; })
    .slice(0, 10);
  $("done-list").innerHTML = done.length
    ? done.map(function (o) {
        const tag = o.status === "Cancelled" ? ' <span class="tag red">Cancelled</span>' : "";
        return '<div class="list-row">' +
          '<span><span class="hl-token">#' + o.token + '</span>' + tag + ' ' +
            '<span class="hl-id">Student ID: ' + esc(o.studentId || "not given") + '</span> ' +
            esc(itemsText(o)) + greenLineHtml(o) + '</span>' +
          '<span class="price">' + o.total + ' Tk <span class="muted" style="font-weight:600">· ' + timeText(o) + '</span></span>' +
        '</div>';
      }).join("")
    : '<div class="empty">Nothing completed yet.</div>';
}

function ticketHtml(o) {
  return '<div class="ticket ' + o.status + '">' +
    '<div class="stub"><small>Token</small><b>' + o.token + '</b></div>' +
    '<div class="body">' +
      '<div>' + studentIdHtml(o) + '</div>' +
      '<div class="items">' + esc(itemsText(o)) + '</div>' +
      '<div class="meta">' + o.total + ' Tk, ordered at ' + timeText(o) + '</div>' +
      greenLineHtml(o) +
      '<button class="small" data-act="advance" data-id="' + o.id + '">' + NEXT_LABEL[o.status] + '</button>' +
    '</div></div>';
}

function advanceOrder(id) {
  const o = state.orders.find(function (x) { return x.id === id; });
  if (!o) return;
  const next = STATUS_FLOW[STATUS_FLOW.indexOf(o.status) + 1];
  if (!next) return;
  updateDoc(doc(db, "orders", id), { status: next }).catch(function (err) {
    toast("Could not update the order.");
    console.error(err);
  });
}

// ---------- end of day ----------
async function endOfDay() {
  let all;
  try {
    all = await getDocs(collection(db, "orders"));
  } catch (err) {
    toast("Could not read orders. Try again.");
    console.error(err);
    return;
  }

  if (all.empty) {
    toast("No orders to close today.");
    return;
  }

  const activeCount = all.docs.filter(function (d) {
    const s = d.data().status;
    return s !== "Done" && s !== "Cancelled";
  }).length;
  let msg = "Save today's report and remove all " + all.size + " orders? Token numbers will restart from 1.";
  if (activeCount > 0) {
    msg += "\n\n" + activeCount + " order(s) are still active and will also be removed.";
  }
  if (!confirm(msg)) return;
  if (!confirm("This cannot be undone. Are you sure?")) return;

  // Build the summary before anything is deleted.
  // Cancelled orders are not counted in sales, items or the order total.
  let totalSales = 0;
  let countedOrders = 0;
  const itemCount = {};   // name -> qty (Top items list)
  const itemDetail = {};  // name -> {qty, amount} (detail popup)
  all.docs.forEach(function (d) {
    const o = d.data();
    if (o.status === "Cancelled") return;
    countedOrders++;
    totalSales += Number(o.total) || 0;
    (o.items || []).forEach(function (i) {
      const qty = Number(i.qty) || 0;
      const amount = i.price !== undefined ? qty * (Number(i.price) || 0) : null;
      itemCount[i.name] = (itemCount[i.name] || 0) + qty;
      if (!itemDetail[i.name]) itemDetail[i.name] = { name: i.name, qty: 0, amount: 0, priced: true };
      itemDetail[i.name].qty += qty;
      if (amount === null) itemDetail[i.name].priced = false;
      else itemDetail[i.name].amount += amount;
    });
  });
  const itemDetails = Object.values(itemDetail)
    .map(function (x) { return { name: x.name, qty: x.qty, amount: x.priced ? x.amount : null }; })
    .sort(function (a, b) { return b.qty - a.qty; });

  const btn = $("eod-btn");
  btn.disabled = true;
  btn.textContent = "Closing the day...";

  try {
    // 1. Save the report first. If this fails, nothing is deleted.
    await addDoc(collection(db, "daily_reports"), {
      date: todayKey(),
      totalOrders: countedOrders,
      totalSales: totalSales,
      items: itemCount,
      itemDetails: itemDetails,
      activeAtClose: activeCount,
      createdAt: serverTimestamp()
    });

    // 2. Delete all orders in batches (Firestore allows up to 500 per batch)
    const docs = all.docs;
    for (let i = 0; i < docs.length; i += 400) {
      const batch = writeBatch(db);
      docs.slice(i, i + 400).forEach(function (d) { batch.delete(d.ref); });
      await batch.commit();
    }

    // 3. Restart token numbers from 1
    await setDoc(doc(db, "counters", "orders"), { last: 0 });

    toast("Day closed. Report saved and tokens restart from 1.");
  } catch (err) {
    toast("Could not close the day. Nothing was deleted if the report failed. Try again.");
    console.error(err);
  }

  btn.disabled = false;
  btn.textContent = "End of day: save report and reset tokens";
}

// ---------- past reports ----------
function watchReports() {
  onSnapshot(query(collection(db, "daily_reports"), orderBy("createdAt", "desc"), limit(30)),
    function (snap) {
      state.reports = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      renderReports();
    },
    function (err) { console.error(err); }
  );
}

function namedItems(r) {
  // Reports saved before the detail update only have the items map (qty only)
  if (Array.isArray(r.itemDetails) && r.itemDetails.length) return r.itemDetails;
  return Object.keys(r.items || {}).map(function (name) {
    return { name: name, qty: r.items[name], amount: null };
  }).sort(function (a, b) { return b.qty - a.qty; });
}

function renderReports() {
  const reports = state.reports;
  if (!reports.length) {
    $("sum").innerHTML = "";
    $("reports-list").innerHTML = '<div class="empty">No reports yet. A report is saved each time you press End of day.</div>';
    return;
  }

  // Summary across all saved days
  const sales = reports.reduce(function (a, r) { return a + (Number(r.totalSales) || 0); }, 0);
  const orderTotal = reports.reduce(function (a, r) { return a + (Number(r.totalOrders) || 0); }, 0);
  const totals = {};
  reports.forEach(function (r) {
    namedItems(r).forEach(function (i) {
      if (!totals[i.name]) totals[i.name] = { name: i.name, qty: 0, days: 0 };
      totals[i.name].qty += Number(i.qty) || 0;
      totals[i.name].days += 1;
    });
  });
  const ranked = Object.values(totals).sort(function (a, b) { return b.qty - a.qty; });
  const best = ranked[0];
  const next3 = ranked.slice(1, 4).map(function (x) { return x.name; }).join(", ") || "None";
  $("sum").innerHTML =
    '<div class="tile"><span>Days recorded</span><b>' + reports.length + '</b><small>' + orderTotal + ' orders in total</small></div>' +
    '<div class="tile top"><span>Top item overall</span><b>' + esc(best ? best.name : "None") + '</b><small>' +
      (best ? best.qty + ' sold across ' + best.days + ' day(s)' : '') + '</small></div>' +
    '<div class="tile"><span>Total sales</span><b>' + sales + ' Tk</b><small>all saved days</small></div>' +
    '<div class="tile"><span>Next best sellers</span><b style="font-size:15px;line-height:1.3">' + esc(next3) + '</b></div>';

  $("reports-list").innerHTML = reports.map(function (r) {
    const top = namedItems(r).slice(0, 5);
    const max = top.length ? Number(top[0].qty) || 1 : 1;
    const bars = top.map(function (i) {
      return '<div class="ti"><div class="nm">' + esc(i.name) + '</div>' +
        '<div class="trow"><div class="track"><i style="width:' + Math.round((Number(i.qty) || 0) / max * 100) + '%"></i></div>' +
        '<b>x' + i.qty + '</b></div></div>';
    }).join("") || '<div class="muted">No items recorded.</div>';
    return '<div class="report" data-report="' + r.id + '" tabindex="0" role="button" aria-label="Details for ' + esc(r.date || "") + '">' +
      '<div class="rh"><span class="date">' + esc(r.date || "") + '</span><span class="sales">' + (r.totalSales || 0) + ' Tk</span></div>' +
      '<div class="rmeta">' + (r.totalOrders || 0) + ' orders</div>' +
      bars +
      '<span class="go">View full details &rarr;</span>' +
    '</div>';
  }).join("");
}

function openReport(id) {
  const r = state.reports.find(function (x) { return x.id === id; });
  if (!r) return;
  const rows = namedItems(r).slice().sort(function (a, b) {
    return (Number(b.amount) || 0) - (Number(a.amount) || 0) || b.qty - a.qty;
  });
  const soldQty = rows.reduce(function (a, i) { return a + (Number(i.qty) || 0); }, 0);
  const hasAmounts = rows.some(function (i) { return i.amount !== null && i.amount !== undefined; });
  const sales = Number(r.totalSales) || 0;
  const topName = rows.length ? rows[0].name : "None";

  $("modal").innerHTML =
    '<div class="mh">' +
      '<div><div class="eyebrow">Daily detail</div><h2>' + esc(r.date || "") + '</h2></div>' +
      '<button class="x" data-close aria-label="Close">&times;</button>' +
    '</div>' +
    '<div class="mstats">' +
      '<div><span>Orders</span><b>' + (r.totalOrders || 0) + '</b></div>' +
      '<div><span>Sales</span><b>' + sales + ' Tk</b></div>' +
      '<div><span>Items sold</span><b>' + soldQty + '</b></div>' +
      '<div><span>Top item</span><b>' + esc(topName) + '</b></div>' +
    '</div>' +
    '<table class="dt">' +
      '<thead><tr><th>Item</th><th class="r">Qty</th><th class="r">Amount</th><th>Share</th></tr></thead>' +
      '<tbody>' + rows.map(function (i) {
        const hasAmt = i.amount !== null && i.amount !== undefined;
        const pct = hasAmt && sales ? Math.round(i.amount / sales * 100) : 0;
        return '<tr>' +
          '<td>' + esc(i.name) + '</td>' +
          '<td class="r">' + i.qty + '</td>' +
          '<td class="r">' + (hasAmt ? i.amount + ' Tk' : '-') + '</td>' +
          '<td>' + (hasAmt ? '<div class="share"><i style="width:' + pct + '%"></i></div>' : '') + '</td>' +
        '</tr>';
      }).join("") + '</tbody>' +
      '<tfoot><tr><td>Total</td><td class="r">' + soldQty + '</td><td class="r">' + sales + ' Tk</td><td></td></tr></tfoot>' +
    '</table>' +
    (hasAmounts ? '' : '<p class="note-small">Amounts per item were not saved for this report. Only quantities are shown.</p>');

  $("overlay").classList.remove("hidden");
  const closeBtn = $("modal").querySelector("[data-close]");
  if (closeBtn) closeBtn.focus();
}

function closeReport() {
  $("overlay").classList.add("hidden");
}

// open a report card, close the popup with X or the dark background
onClick(function (e) {
  if (e.target.closest("[data-close]") || e.target === $("overlay")) { closeReport(); return true; }
  const rep = e.target.closest("[data-report]");
  if (rep) { openReport(rep.dataset.report); return true; }
  return false;
});

onEscape(closeReport);

// Enter / Space on a report card opens it
document.addEventListener("keydown", function (e) {
  if ((e.key === "Enter" || e.key === " ") && e.target.matches && e.target.matches("[data-report]")) {
    e.preventDefault();
    openReport(e.target.dataset.report);
  }
});