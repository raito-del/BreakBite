// staff/menu.js
// Menu panel, Food Waste Saver, Promo Codes, and Settings (Break Planner).
// Plugs into staff/core.js. Reads and writes state.menu and state.promos.
import {
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc, getDoc,
  onSnapshot, query, orderBy, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import {
  db, state, $, esc, toast, onLogin, onAction
} from "./core.js";

const DEFAULT_EAT_MIN = 5;

let freshPromo = null;   // promo just created (row animation)
let poppedPromo = null;  // promo just switched on/off (tag animation)

function finalPrice(f) {
  return Math.round(f.price * (100 - (f.discount || 0)) / 100);
}

// ---------- start after login ----------
onLogin(function () {
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
    const price = f.discount > 0
      ? '<s class="off-text">' + f.price + '</s> <b>' + finalPrice(f) + ' Tk</b> <span class="badge">' + f.discount + '% off</span>'
      : f.price + ' Tk';
    const eat = (f.minutes || DEFAULT_EAT_MIN) + ' min';
    return '<tr>' +
      '<td data-label="Item">' + esc(f.name) + '</td>' +
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
  const price = parseInt($("food-price").value, 10);
  const minutes = parseInt($("food-minutes").value, 10);
  if (!name || isNaN(price) || price < 0) {
    toast("Enter a food name and a valid price.");
    return;
  }
  try {
    await addDoc(collection(db, "menu"), {
      name: name,
      price: price,
      minutes: isNaN(minutes) || minutes < 1 ? DEFAULT_EAT_MIN : minutes,
      available: true,
      discount: 0,
      order: Date.now()
    });
    $("food-name").value = "";
    $("food-price").value = "";
    $("food-minutes").value = "";
    toast(name + " added to the menu.");
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
  const priceText = prompt("Price (Tk):", f.price);
  if (priceText === null) return;
  const minText = prompt("Eat time (minutes):", f.minutes || DEFAULT_EAT_MIN);
  if (minText === null) return;
  const price = parseInt(priceText, 10);
  const minutes = parseInt(minText, 10);
  if (!name.trim() || isNaN(price) || price < 0 || isNaN(minutes) || minutes < 1) {
    toast("Name, price or eat time is not valid.");
    return;
  }
  updateDoc(doc(db, "menu", id), { name: name.trim(), price: price, minutes: minutes });
  toast("Menu item updated.");
}

function deleteFood(id) {
  const f = state.menu.find(function (x) { return x.id === id; });
  if (!f) return;
  if (!confirm("Remove " + f.name + " from the menu?")) return;
  deleteDoc(doc(db, "menu", id));
}

// ---------- food waste saver ----------
function renderWaste() {
  const available = state.menu.filter(function (f) { return f.available; });
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
// Each code is one document in "promos", and the document ID is the code itself.
// Fields: code, percent, active, used, createdAt  (the student page reads these)
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
    freshPromo = code; // set before the write so the first redraw animates the new row
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

// ---------- settings: break planner ----------
const PLANNER_DEFAULTS = { minBreak: 10, maxBreak: 45, step: 5, defaultEat: 5 };

async function loadPlannerSettings() {
  try {
    const snap = await getDoc(doc(db, "settings", "planner"));
    const s = Object.assign({}, PLANNER_DEFAULTS, snap.exists() ? snap.data() : {});
    $("pl-min").value = s.minBreak;
    $("pl-max").value = s.maxBreak;
    $("pl-step").value = s.step;
    $("pl-default").value = s.defaultEat;
  } catch (err) {
    console.error(err);
  }
}

async function savePlannerSettings() {
  const minBreak = parseInt($("pl-min").value, 10);
  const maxBreak = parseInt($("pl-max").value, 10);
  const step = parseInt($("pl-step").value, 10);
  const defaultEat = parseInt($("pl-default").value, 10);
  if (isNaN(minBreak) || isNaN(maxBreak) || minBreak < 1 || maxBreak <= minBreak) {
    toast("Longest break must be bigger than shortest break.");
    return;
  }
  if (isNaN(step) || step < 1 || isNaN(defaultEat) || defaultEat < 1) {
    toast("Step and default eat time must be at least 1.");
    return;
  }
  try {
    await setDoc(doc(db, "settings", "planner"), {
      minBreak: minBreak, maxBreak: maxBreak, step: step, defaultEat: defaultEat
    });
    toast("Planner settings saved.");
  } catch (err) {
    toast("Could not save planner settings.");
    console.error(err);
  }
}