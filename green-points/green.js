// green-points/green.js
// Green Points core logic: rules, items, wallets, submissions, coin spending.
// Only this file touches the Green Points data. Pages import from here.
// Existing firebase.js is used as-is (exports db and auth).
import { db } from "../firebase.js";
import {
  collection, doc, getDoc, getDocs, query, where, orderBy,
  runTransaction, serverTimestamp, addDoc
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---------- defaults (used if the settings document does not exist yet) ----------
export const GREEN_DEFAULTS = {
  coinTk: 1,        // 1 coin = this many Tk off
  maxPct: 30,       // max % of food total payable with coins
  dailyCap: 20,     // max items one student can submit per day
  eatMinutes: 5     // used only by future planner hooks
};

// ---------- helpers ----------
export function todayKey() {
  return new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD in local time
}

export function isValidStudentId(sid) {
  return typeof sid === "string" && /^[0-9A-Za-z-]{4,12}$/.test(sid);
}

// ---------- rules ----------
// Firestore: settings/green  { coinTk, maxPct, dailyCap, eatMinutes }
export async function getGreenRules() {
  try {
    const snap = await getDoc(doc(db, "settings", "green"));
    return snap.exists() ? Object.assign({}, GREEN_DEFAULTS, snap.data()) : Object.assign({}, GREEN_DEFAULTS);
  } catch (err) {
    console.error("getGreenRules", err);
    return Object.assign({}, GREEN_DEFAULTS);
  }
}

// ---------- items ----------
// Firestore: greenItems/{itemId}  { name, coins, active, order }
export async function getGreenItems() {
  const snap = await getDocs(query(collection(db, "greenItems"), orderBy("order")));
  return snap.docs
    .map(d => Object.assign({ id: d.id }, d.data()))
    .filter(i => i.active !== false && i.coins > 0);
}

// ---------- wallets ----------
// Firestore: wallets/{sid}  { balance, issued, redeemed }
// History is a subcollection: wallets/{sid}/history/{autoId}
export async function getWallet(sid) {
  const snap = await getDoc(doc(db, "wallets", sid));
  if (!snap.exists()) return { balance: 0, issued: 0, redeemed: 0 };
  const d = snap.data();
  return { balance: d.balance || 0, issued: d.issued || 0, redeemed: d.redeemed || 0 };
}

// ---------- submissions ----------
// Firestore: greenSubmissions/{autoId}
//   { code, sid, items: [{id, name, coins, qty}], coins, status, day, checked, createdAt, decidedAt }
// Status: "Pending" | "Approved" | "Rejected"

// How many items this student already submitted today (not rejected).
export async function dailyItemsUsed(sid, day = todayKey()) {
  const snap = await getDocs(query(
    collection(db, "greenSubmissions"),
    where("sid", "==", sid),
    where("day", "==", day)
  ));
  return snap.docs
    .map(d => d.data())
    .filter(s => s.status !== "Rejected")
    .reduce((a, s) => a + (s.items || []).reduce((x, i) => x + i.qty, 0), 0);
}

// picks: { itemId: qty, ... }  -- the client sends only ids and quantities.
// Names and coin values are read from Firestore here, so the client cannot set its own coins.
// Returns the new G-code.
// Known limit: the daily-limit check reads before writing; two simultaneous submits
// from the same student could both pass. Acceptable for this project stage.
export async function submitGreen(sid, picks) {
  if (!isValidStudentId(sid)) throw new Error("INVALID_SID");

  const entries = Object.keys(picks).map(id => ({ id, qty: parseInt(picks[id], 10) }))
    .filter(e => e.qty > 0);
  if (!entries.length) throw new Error("NO_ITEMS");

  const rules = await getGreenRules();
  const items = await getGreenItems();
  const byId = {};
  items.forEach(i => { byId[i.id] = i; });

  const snapshot = entries.map(e => {
    const item = byId[e.id];
    if (!item) throw new Error("ITEM_NOT_AVAILABLE");
    if (e.qty < 1 || e.qty > 20) throw new Error("BAD_QTY");
    return { id: item.id, name: item.name, coins: item.coins, qty: e.qty };
  });

  const totalItems = snapshot.reduce((a, i) => a + i.qty, 0);
  const used = await dailyItemsUsed(sid);
  if (used + totalItems > rules.dailyCap) throw new Error("DAILY_LIMIT");

  const totalCoins = snapshot.reduce((a, i) => a + i.coins * i.qty, 0);
  const day = todayKey();

  // G-code from a counter, so codes never repeat
  const code = await runTransaction(db, async tx => {
    const cRef = doc(db, "counters", "green");
    const cSnap = await tx.get(cRef);
    const next = (cSnap.exists() ? cSnap.data().last || 0 : 0) + 1;
    tx.set(cRef, { last: next }, { merge: true });
    return "G-" + (100 + next);
  });

  await addDoc(collection(db, "greenSubmissions"), {
    code,
    sid,
    items: snapshot,
    coins: totalCoins,
    status: "Pending",
    checked: false,
    day,
    createdAt: serverTimestamp(),
    decidedAt: null
  });

  return code;
}

// Staff: tick "I checked the items" before approving.
export async function setChecked(submissionId, checked) {
  const { updateDoc } = await import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js");
  await updateDoc(doc(db, "greenSubmissions", submissionId), { checked: !!checked });
}

// Staff approves: adds coins to the wallet, in one transaction.
export async function approveSubmission(submissionId) {
  return runTransaction(db, async tx => {
    const sRef = doc(db, "greenSubmissions", submissionId);
    const sSnap = await tx.get(sRef);
    if (!sSnap.exists()) throw new Error("NOT_FOUND");
    const s = sSnap.data();
    if (s.status !== "Pending") throw new Error("ALREADY_DECIDED");
    if (!s.checked) throw new Error("NOT_CHECKED");

    const wRef = doc(db, "wallets", s.sid);
    const wSnap = await tx.get(wRef);
    const w = wSnap.exists() ? wSnap.data() : { balance: 0, issued: 0, redeemed: 0 };

    tx.set(wRef, {
      balance: (w.balance || 0) + s.coins,
      issued: (w.issued || 0) + s.coins,
      redeemed: w.redeemed || 0
    }, { merge: true });

    const hRef = doc(collection(db, "wallets", s.sid, "history"));
    tx.set(hRef, { text: "Green Points added (" + s.code + ")", delta: s.coins, at: serverTimestamp() });

    tx.update(sRef, { status: "Approved", decidedAt: serverTimestamp() });
    return s.coins;
  });
}

// Staff rejects: no coins are added.
export async function rejectSubmission(submissionId) {
  return runTransaction(db, async tx => {
    const sRef = doc(db, "greenSubmissions", submissionId);
    const sSnap = await tx.get(sRef);
    if (!sSnap.exists()) throw new Error("NOT_FOUND");
    if (sSnap.data().status !== "Pending") throw new Error("ALREADY_DECIDED");
    tx.update(sRef, { status: "Rejected", decidedAt: serverTimestamp() });
  });
}

// ---------- spending coins on an order ----------
// Called by the order flow later. Checks balance and the per-order % limit on the server side.
// foodTotalTk: the food total before coins. Returns the Tk discount applied.
export async function spendCoins(sid, coinsWanted, foodTotalTk) {
  if (!isValidStudentId(sid)) throw new Error("INVALID_SID");
  const rules = await getGreenRules();
  const wanted = Math.max(0, Math.floor(coinsWanted));
  if (!wanted) return 0;

  return runTransaction(db, async tx => {
    const wRef = doc(db, "wallets", sid);
    const wSnap = await tx.get(wRef);
    const w = wSnap.exists() ? wSnap.data() : { balance: 0, issued: 0, redeemed: 0 };
    const maxByPct = Math.floor(foodTotalTk * rules.maxPct / 100);
    const maxByPrice = Math.floor(foodTotalTk / rules.coinTk);
    const use = Math.min(wanted, w.balance || 0, maxByPct, maxByPrice);
    if (use <= 0) return 0;

    tx.set(wRef, {
      balance: (w.balance || 0) - use,
      issued: w.issued || 0,
      redeemed: (w.redeemed || 0) + use
    }, { merge: true });

    const hRef = doc(collection(db, "wallets", sid, "history"));
    tx.set(hRef, { text: "Used on order (" + use + " coins)", delta: -use, at: serverTimestamp() });

    return use * rules.coinTk; // Tk off
  });
}
// ---------- student read helpers (added for the student page) ----------
// Submissions of one student, newest first.
export async function getMySubmissions(sid, max = 10) {
  const snap = await getDocs(query(collection(db, "greenSubmissions"), where("sid", "==", sid)));
  return snap.docs
    .map(d => Object.assign({ id: d.id }, d.data()))
    .sort((a, b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0))
    .slice(0, max);
}

// Coin history of one student, newest first.
export async function getWalletHistory(sid, max = 10) {
  const snap = await getDocs(query(collection(db, "wallets", sid, "history"), orderBy("at", "desc")));
  return snap.docs.map(d => d.data()).slice(0, max);
}