// staff/menu.js
// Menu panel, Food Waste Saver, Promo Codes, and Settings (Break Planner + canteen timing).
// Plugs into staff/core.js. Reads and writes state.menu and state.promos.
import {
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc, getDoc,
  onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  db, state, $, esc, toast, onLogin, onAction
} from "./core.js";

const DEFAULT_EAT_MIN = 5;
const SLOTS = { morning: "Morning", lunch: "Lunch", fast: "Fast food" };

let freshPromo = null;   // promo just created (row animation)
let poppedPromo = null;  // promo just switched on/off (tag animation)

// Market-price items have price = null (no fixed Tk).
function finalPrice(f) {
  if (f.price == null) return null;
  return Math.round(f.price * (100 - (f.discount || 0)) / 100);
}

function priceLabel(f) {
  if (f.price == null) return "Market price";
  return f.price + " Tk";
}

// Items added before the slot update have no slot. They stay as "No slot yet".
function slotLabel(f) {
  return SLOTS[f.slot] || "No slot yet";
}

function cancelLabel(f) {
  if (f.cancelMinutes === undefined || f.cancelMinutes === null) return "Not set";
  if (f.cancelMinutes === 0) return "No cancel";
  return f.cancelMinutes + " min";
}

// ---------- start after login ----------
onLogin(function () {
  ensureMenuExtras();
  ensurePlannerExtras();
  watchMenu();
  watchPromos();
  loadPlannerSettings();
});

onAction("toggle", function (id) { toggleAvailable(id); });
onAction("edit", function (id) { editFood(id); });
onAction("delete", function (id) { deleteFood(id); });
onAction("stopDiscount", function (id) { setDiscount(id, 0); });
onAction("promoToggle", function (id) { togglePromo(id); });
onAction("promoDelete", function (id) { deletePromo(id); });

$("add-food-btn").addEventListener("click", addFood);
$("waste-start").addEventListener("click", startDiscount);
$("promo-add").addEventListener("click", addPromo);
$("planner-save").addEventListener("click", savePlannerSettings);

// Adds the slot and cancel-time inputs to the existing add-food form.
function ensureMenuExtras() {
  const btn = $("add-food-btn");
  if (!btn || $("food-slot")) return;
  const wrap = document.createElement("div");
  wrap.className = "menu-extras";
  wrap.setAttribute("style", "display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;");
  wrap.innerHTML =
    '<select id="food-slot" aria-label="Slot">' +
      '<option value="">Choose slot</option>' +
      '<option value="morning">Morning</option>' +
      '<option value="lunch">Lunch</option>' +
      '<option value="fast">Fast food</option>' +
    '</select>' +
    '<input id="food-cancel" type="number" min="0" max="60" placeholder="Cancel min (0 = no cancel)" aria-label="Cancel minutes">';
  btn.parentNode.insertBefore(wrap, btn);
}

// Adds the timing and ordering inputs to the planner settings form. All save to settings/planner.
function ensurePlannerExtras() {
  const save = $("planner-save");
  if (!save || $("pl-open")) return;
  const wrap = document.createElement("div");
  wrap.className = "menu-extras";
  wrap.setAttribute("style", "display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px;");
  wrap.innerHTML =
    '<label style="font-size:13px">Canteen opens (HH:MM) <input id="pl-open" type="text" placeholder="08:30" maxlength="5" style="width:90px"></label>' +
    '<label style="font-size:13px">Canteen closes (HH:MM) <input id="pl-close" type="text" placeholder="16:00" maxlength="5" style="width:90px"></label>' +
    '<label style="font-size:13px">Morning ends (HH:MM) <input id="pl-morning-end" type="text" placeholder="11:00" maxlength="5" style="width:90px"></label>' +
    '<label style="font-size:13px">Lunch ends (HH:MM) <input id="pl-lunch-end" type="text" placeholder="16:00" maxlength="5" style="width:90px"></label>' +
    '<label style="font-size:13px">Staff gets order before pickup (min) <input id="pl-lead" type="number" min="0" max="120" style="width:90px"></label>' +
    '<label style="font-size:13px">Max orders per 15 min <input id="pl-cap" type="number" min="1" max="500" style="width:90px"></label>' +
    '<label style="font-size:13px">Book ahead up to (min) <input id="pl-ahead" type="number" min="30" max="1440" style="width:90px"></label>';
  save.parentNode.insertBefore(wrap, save);
}

// ---------- menu ----------
function watchMenu() {
  onSnapshot(query(collection(db, "menu"), orderBy("order")),
    function (snap) {
      state.menu = snap.docs.map(function (d) { return Object.assign({ id: d.id }, d.data()); });
      renderMenu();
      renderWaste();
    },
    function (err) { toast("Could not load the menu."); console.error(err); }
  );
}

function renderMenu() {
  const rows = state.menu.map(function (f) {
    const price = f.discount > 0 && f.price != null
      ? '<s class="off-text">' + f.price + '</s> <b>' + finalPrice(f) + ' Tk</b> <span class="badge">' + f.discount + '% off</span>'
      : priceLabel(f);
    const eat = (f.minutes || DEFAULT_EAT_MIN) + ' min';
    const slotBadge = f.slot ? '' : ' <span class="badge off">No slot yet</span>';
    return '<tr>' +
      '<td data-label="Item">' + esc(f.name) + slotBadge +
        '<div class="muted small">' + esc(slotLabel(f)) + ' · Cancel: ' + esc(cancelLabel(f)) + '</div></td>' +
      '<td data-label="Price">' + price + '</td>' +
      '<td data-label="Eat time">' + eat + '</td>' +
      '<td data-label="Status"><span class="badge ' + (f.available ? "green" : "off") + '">' + (f.available ? "Available" : "Sold out") + '</span></td>' +
      '<td class="actions">' +
        '<button class="ghost small" data-act="toggle" data-id="' + f.id + '">' + (f.available ? "Mark sold out" : "Mark available") + '</button>' +
        '<button class="ghost small" data-act="edit" data-id="' + f.id + '">Edit</button>' +
        '<button class="danger small" data-act="delete" data-id="' + f.id + '">Delete</button>' +
      '</td></tr>';
  });
  $("menu-body").innerHTML = rows.length
    ? rows.join("")
    : '<tr><td colspan="5" class="empty">No items yet. Add one below.</td></tr>';
}

async function addFood() {
  const name = $("food-name").value.trim();
  const priceText = $("food-price").value.trim();
  const minutes = parseInt($("food-minutes").value, 10);
  const slot = $("food-slot") ? $("food-slot").value : "";
  const cancelText = $("food-cancel") ? $("food-cancel").value.trim() : "";

  if (!name) { toast("Enter a food name."); return; }
  if (!slot) { toast("Choose a slot: Morning, Lunch or Fast food."); return; }

  let price = null;
  if (priceText !== "") {
    price = parseInt(priceText, 10);
    if (isNaN(price) || price < 0) { toast("Price must be a number, or leave it empty for market price."); return; }
  } else if (slot !== "fast") {
    toast("Enter a price for this item.");
    return;
  }

  const cancelMinutes = cancelText === "" ? 0 : parseInt(cancelText, 10);
  if (isNaN(cancelMinutes) || cancelMinutes < 0 || cancelMinutes > 60) {
    toast("Cancel minutes must be between 0 and 60. Use 0 for no cancel.");
    return;
  }

  try {
    await addDoc(collection(db, "menu"), {
      name: name,
      price: price,
      minutes: isNaN(minutes) || minutes < 1 ? DEFAULT_EAT_MIN : minutes,
      slot: slot,
      cancelMinutes: cancelMinutes,
      available: true,
      discount: 0,
      order: Date.now()
    });
    $("food-name").value = "";
    $("food-price").value = "";
    $("food-minutes").value = "";
    if ($("food-slot")) $("food-slot").value = "";
    if ($("food-cancel")) $("food-cancel").value = "";
    toast(name + " added to " + SLOTS[slot] + ".");
  } catch (err) {
    toast("Could not add the item.");
    console.error(err);
  }
}

function toggleAvailable(id) {
  const f = state.menu.find(function (x) { return x.id === id; });
  if (!f) return;
  updateDoc(doc(db, "menu", id), { available: !f.available });
}

function editFood(id) {
  const f = state.menu.find(function (x) { return x.id === id; });
  if (!f) return;
  const name = prompt("Food name:", f.name);
  if (name === null) return;
  const priceText = prompt("Price (Tk). Leave empty for market price:", f.price == null ? "" : f.price);
  if (priceText === null) return;
  const minText = prompt("Eat time (minutes):", f.minutes || DEFAULT_EAT_MIN);
  if (minText === null) return;
  const slotText = prompt("Slot: type morning, lunch or fast", f.slot || "");
  if (slotText === null) return;
  const cancelText = prompt("Cancel within how many minutes? (0 = cannot cancel)", f.cancelMinutes == null ? 0 : f.cancelMinutes);
  if (cancelText === null) return;

  const slot = slotText.trim().toLowerCase();
  const minutes = parseInt(minText, 10);
  const cancelMinutes = parseInt(cancelText, 10);
  let price = null;
  if (priceText.trim() !== "") {
    price = parseInt(priceText, 10);
    if (isNaN(price) || price < 0) { toast("Price is not valid."); return; }
  }

  if (!name.trim()) { toast("Food name is empty."); return; }
  if (!SLOTS[slot]) { toast("Slot must be morning, lunch or fast."); return; }
  if (isNaN(minutes) || minutes < 1) { toast("Eat time is not valid."); return; }
  if (isNaN(cancelMinutes) || cancelMinutes < 0 || cancelMinutes > 60) { toast("Cancel minutes must be 0 to 60."); return; }
  if (price === null && slot !== "fast") { toast("Only fast food can have no price."); return; }

  updateDoc(doc(db, "menu", id), {
    name: name.trim(),
    price: price,
    minutes: minutes,
    slot: slot,
    cancelMinutes: cancelMinutes
  }).then(function () {
    toast("Menu item updated.");
  }).catch(function (err) {
    toast("Could not update the item.");
    console.error(err);
  });
}

function deleteFood(id) {
  const f = state.menu.find(function (x) { return x.id === id; });
  if (!f) return;
  if (!confirm("Remove " + f.name + " from the menu?")) return;
  deleteDoc(doc(db, "menu", id));
}

// ---------- food waste saver ----------
function renderWaste() {
  const available = state.menu.filter(function (f) { return f.available && f.price != null; });
  $("waste-food").innerHTML = available.map(function (f) {
    return '<option value="' + f.id + '">' + esc(f.name) + ' (' + f.price + ' Tk)</option>';
  }).join("");

  const discounted = state.menu.filter(function (f) { return f.discount > 0; });
  $("waste-list").innerHTML = discounted.length
    ? discounted.map(function (f) {
        return '<div class="list-row">' +
          '<span><b>' + esc(f.name) + '</b>: ' + f.discount + '% off, now ' + finalPrice(f) + ' Tk</span>' +
          '<button class="ghost small" data-act="stopDiscount" data-id="' + f.id + '">Stop discount</button>' +
        '</div>';
      }).join("")
    : '<div class="empty">No discounts running. Pick a food above to start one.</div>';
}

function setDiscount(id, percent) {
  updateDoc(doc(db, "menu", id), { discount: percent }).catch(function (err) {
    toast("Could not save the discount.");
    console.error(err);
  });
}

function startDiscount() {
  const id = $("waste-food").value;
  const percent = parseInt($("waste-percent").value, 10);
  if (!id) { toast("Choose a food item first."); return; }
  if (isNaN(percent) || percent < 5 || percent > 90) {
    toast("Discount must be between 5 and 90.");
    return;
  }
  setDiscount(id, percent);
  toast("Discount started.");
}

// ---------- promo codes ----------
function watchPromos() {
  onSnapshot(collection(db, "promos"),
    function (snap) {
      state.promos = snap.docs
        .map(function (d) { return Object.assign({ id: d.id }, d.data()); })
        .sort(function (a, b) {
          const ta = a.createdAt && a.createdAt.toMillis ? a.createdAt.toMillis() : Date.now();
          const tb = b.createdAt && b.createdAt.toMillis ? b.createdAt.toMillis() : Date.now();
          return tb - ta;
        });
      renderPromos();
    },
    function (err) { toast("Could not load promo codes."); console.error(err); }
  );
}

function renderPromos() {
  $("promo-list").innerHTML = state.promos.length
    ? state.promos.map(function (p) {
        const used = p.used || 0;
        const fresh = p.id === freshPromo ? " fresh" : "";
        const pop = p.id === poppedPromo ? " pop" : "";
        return '<div class="list-row' + fresh + '">' +
          '<span><b>' + esc(p.id) + '</b>: ' + p.percent + '% off, used ' + used + (used === 1 ? ' time' : ' times') + ' ' +
            '<span class="tag ' + (p.active ? "on" : "off") + pop + '">' + (p.active ? "Active" : "Off") + '</span></span>' +
          '<span class="staff-actions" style="margin:0">' +
            '<button class="ghost small" data-act="promoToggle" data-id="' + esc(p.id) + '">' + (p.active ? "Turn off" : "Turn on") + '</button>' +
            '<button class="danger small" data-act="promoDelete" data-id="' + esc(p.id) + '">Delete</button>' +
          '</span>' +
        '</div>';
      }).join("")
    : '<div class="empty">No promo codes yet. Create one above.</div>';
  freshPromo = null;
  poppedPromo = null;
}

async function addPromo() {
  const btn = $("promo-add");
  const msg = $("promo-msg");
  msg.textContent = "";
  const code = $("promo-code").value.trim().toUpperCase();
  const percent = parseInt($("promo-percent").value, 10);

  if (!/^[A-Z0-9]{3,12}$/.test(code)) {
    msg.textContent = "Code must be 3 to 12 letters or numbers, no spaces.";
    return;
  }
  if (isNaN(percent) || percent < 5 || percent > 90) {
    msg.textContent = "Discount must be between 5 and 90.";
    return;
  }

  btn.classList.add("loading");
  try {
    const ref = doc(db, "promos", code);
    const exists = await getDoc(ref);
    if (exists.exists()) {
      msg.textContent = "This code already exists. Turn it off or delete it first.";
      btn.classList.remove("loading");
      return;
    }
    freshPromo = code;
    await setDoc(ref, {
      code: code,
      percent: percent,
      active: true,
      used: 0,
      createdAt: serverTimestamp()
    });
    $("promo-code").value = "";
    $("promo-percent").value = "";
    toast("Promo code " + code + " created.");
  } catch (err) {
    freshPromo = null;
    msg.textContent = "Could not create the code. Try again.";
    console.error(err);
  }
  btn.classList.remove("loading");
}

function togglePromo(id) {
  const p = state.promos.find(function (x) { return x.id === id; });
  if (!p) return;
  poppedPromo = id;
  updateDoc(doc(db, "promos", id), { active: !p.active }).catch(function (err) {
    poppedPromo = null;
    toast("Could not update the promo code.");
    console.error(err);
  });
}

function deletePromo(id) {
  if (!confirm("Delete promo code " + id + "? Students will no longer be able to use it.")) return;
  deleteDoc(doc(db, "promos", id)).then(function () {
    toast("Promo code deleted.");
  }).catch(function (err) {
    toast("Could not delete the promo code.");
    console.error(err);
  });
}

// ---------- settings: break planner, canteen timing, ordering rules ----------
const SETTINGS_DEFAULTS = {
  minBreak: 10, maxBreak: 45, step: 5, defaultEat: 5,
  morningEnd: "11:00", lunchEnd: "16:00",
  openTime: "08:30", closeTime: "16:00",
  leadMinutes: 10, windowCap: 20, aheadMinutes: 180
};
const HM_RE = /^([01]?\d|2[0-3]):([0-5]\d)$/;

function normalizeHM(text) {
  const m = HM_RE.exec(String(text || "").trim());
  if (!m) return null;
  return String(Number(m[1])).padStart(2, "0") + ":" + m[2];
}
function toMin(s) {
  const p = s.split(":").map(Number);
  return p[0] * 60 + p[1];
}

async function loadPlannerSettings() {
  try {
    const snap = await getDoc(doc(db, "settings", "planner"));
    const s = Object.assign({}, SETTINGS_DEFAULTS, snap.exists() ? snap.data() : {});
    $("pl-min").value = s.minBreak;
    $("pl-max").value = s.maxBreak;
    $("pl-step").value = s.step;
    $("pl-default").value = s.defaultEat;
    $("pl-open").value = s.openTime;
    $("pl-close").value = s.closeTime;
    $("pl-morning-end").value = s.morningEnd;
    $("pl-lunch-end").value = s.lunchEnd;
    $("pl-lead").value = s.leadMinutes;
    $("pl-cap").value = s.windowCap;
    $("pl-ahead").value = s.aheadMinutes;
  } catch (err) {
    console.error(err);
  }
}

async function savePlannerSettings() {
  const minBreak = parseInt($("pl-min").value, 10);
  const maxBreak = parseInt($("pl-max").value, 10);
  const step = parseInt($("pl-step").value, 10);
  const defaultEat = parseInt($("pl-default").value, 10);
  const openTime = normalizeHM($("pl-open").value);
  const closeTime = normalizeHM($("pl-close").value);
  const morningEnd = normalizeHM($("pl-morning-end").value);
  const lunchEnd = normalizeHM($("pl-lunch-end").value);
  const leadMinutes = parseInt($("pl-lead").value, 10);
  const windowCap = parseInt($("pl-cap").value, 10);
  const aheadMinutes = parseInt($("pl-ahead").value, 10);

  if (isNaN(minBreak) || isNaN(maxBreak) || minBreak < 1 || maxBreak <= minBreak) {
    toast("Longest break must be bigger than shortest break.");
    return;
  }
  if (isNaN(step) || step < 1 || isNaN(defaultEat) || defaultEat < 1) {
    toast("Step and default eat time must be at least 1.");
    return;
  }
  if (!openTime || !closeTime || !morningEnd || !lunchEnd) {
    toast("Canteen times must be in HH:MM format, for example 08:30 or 16:00.");
    return;
  }
  if (toMin(openTime) >= toMin(closeTime)) {
    toast("Canteen must open before it closes.");
    return;
  }
  if (!(toMin(openTime) < toMin(morningEnd) && toMin(morningEnd) < toMin(lunchEnd))) {
    toast("Order must be: opens, morning ends, lunch ends.");
    return;
  }
  if (isNaN(leadMinutes) || leadMinutes < 0 || leadMinutes > 120) {
    toast("Staff lead time must be between 0 and 120 minutes.");
    return;
  }
  if (isNaN(windowCap) || windowCap < 1 || windowCap > 500) {
    toast("Max orders per 15 minutes must be between 1 and 500.");
    return;
  }
  if (isNaN(aheadMinutes) || aheadMinutes < 30 || aheadMinutes > 1440) {
    toast("Book-ahead time must be between 30 and 1440 minutes.");
    return;
  }

  try {
    // merge: true keeps any other settings already saved in this document
    await setDoc(doc(db, "settings", "planner"), {
      minBreak: minBreak,
      maxBreak: maxBreak,
      step: step,
      defaultEat: defaultEat,
      openTime: openTime,
      closeTime: closeTime,
      morningEnd: morningEnd,
      lunchEnd: lunchEnd,
      leadMinutes: leadMinutes,
      windowCap: windowCap,
      aheadMinutes: aheadMinutes
    }, { merge: true });
    toast("Settings saved.");
  } catch (err) {
    toast("Could not save settings.");
    console.error(err);
  }
}