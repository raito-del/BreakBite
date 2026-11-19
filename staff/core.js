// staff/core.js
// Shared base for the staff page: login, tabs, toast, helpers, and the
// click/change dispatch that feature files (orders, menu, green) plug into.
// Nothing here is feature-specific.
import { db, auth } from "../firebase.js";
import {
  signInWithEmailAndPassword, signOut, onAuthStateChanged
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";

export { db, auth };

// ---------- shared data (features read and write these) ----------
export const state = {
  orders: [],       // food orders, newest first
  menu: [],         // menu items
  reports: [],      // saved daily reports, newest first
  promos: [],       // promo codes
  greenSubs: [],    // Green Points submissions, newest first
  wallets: {}       // studentId -> wallet data
};

// ---------- small helpers ----------
export const $ = function (id) { return document.getElementById(id); };

export function esc(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

export function toast(msg) {
  const t = $("toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(function () { t.classList.add("hidden"); }, 2500);
}

export function todayKey() {
  return new Date().toLocaleDateString("en-CA");
}

// the day an order was placed (today for orders still being written)
export function dayOf(o) {
  return o.createdAt && o.createdAt.toDate ? o.createdAt.toDate().toLocaleDateString("en-CA") : todayKey();
}

export function timeText(o) {
  const d = o.createdAt && o.createdAt.toDate ? o.createdAt.toDate() : new Date();
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function itemsText(o) {
  return o.items.map(function (i) { return i.name + " x" + i.qty; }).join(", ");
}

// Old orders (placed before the ID was added) show "not given".
export function studentIdHtml(o) {
  return '<span class="badge">Student ID: ' + esc(o.studentId || "not given") + '</span>';
}

// ---------- tabs ----------
export function showTab(name) {
  document.querySelectorAll(".tab").forEach(function (b) {
    b.classList.toggle("active", b.dataset.tab === name);
  });
  document.querySelectorAll(".panel").forEach(function (p) {
    p.classList.toggle("active", p.id === "panel-" + name);
  });
}

// ---------- feature hooks ----------
// Features register what they need here. Core never knows feature details.

// called once, after the staff member logs in
const loginHooks = [];
export function onLogin(fn) { loginHooks.push(fn); }

// re-draw hooks: features register a draw function; render() calls them all
const renderHooks = [];
export function onRender(fn) { renderHooks.push(fn); }
export function render() { renderHooks.forEach(function (fn) { fn(); }); }

// data-act="name" buttons: onAction("advance", function (id, el) { ... })
const actions = {};
export function onAction(name, fn) { actions[name] = fn; }

// click handlers: each fn(e) returns true when it handled the click
const clickHooks = [];
export function onClick(fn) { clickHooks.push(fn); }

// change handlers: fn(e) returns true when it handled the change
const changeHooks = [];
export function onChange(fn) { changeHooks.push(fn); }

// Escape key: every registered function runs (used to close popups)
const escapeHooks = [];
export function onEscape(fn) { escapeHooks.push(fn); }

// ---------- login ----------
let started = false;

onAuthStateChanged(auth, function (user) {
  if (user) {
    $("login-screen").classList.add("hidden");
    $("app").classList.remove("hidden");
    if (!started) {
      started = true;
      loginHooks.forEach(function (fn) { fn(); });
    }
  } else {
    $("login-screen").classList.remove("hidden");
    $("app").classList.add("hidden");
  }
});

$("login-form").addEventListener("submit", async function (e) {
  e.preventDefault();
  $("login-error").textContent = "";
  try {
    await signInWithEmailAndPassword(auth, $("username").value.trim(), $("password").value);
    $("password").value = "";
  } catch (err) {
    $("login-error").textContent = "Wrong email or password. Try again.";
    console.error(err);
  }
});

$("logout-btn").addEventListener("click", function () { signOut(auth); });

// ---------- tab buttons ----------
document.querySelectorAll(".tab").forEach(function (b) {
  b.addEventListener("click", function () { showTab(b.dataset.tab); });
});

// ---------- one dispatcher for all clicks ----------
// data-act buttons are handled here; features add their own click hooks for other elements.
onClick(function (e) {
  const el = e.target.closest("[data-act]");
  if (!el || el.disabled) return false;
  const fn = actions[el.dataset.act];
  if (!fn) return false;
  fn(el.dataset.id, el, e);
  return true;
});

document.addEventListener("click", function (e) {
  for (let i = 0; i < clickHooks.length; i++) {
    if (clickHooks[i](e)) return;
  }
});

document.addEventListener("change", function (e) {
  for (let i = 0; i < changeHooks.length; i++) {
    if (changeHooks[i](e)) return;
  }
});

document.addEventListener("keydown", function (e) {
  if (e.key !== "Escape") return;
  escapeHooks.forEach(function (fn) { fn(); });
});