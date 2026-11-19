// green-points/order-hook.js
// A small helper for student.html. It asks "Add Green Points to this order?"
// and, if the student says yes, lets them pick items and submits them.
// It does NOT place the food order itself; student.html does that after this resolves.
//
// Usage in student.html (later step):
//   import { askGreenPoints } from "./green-points/order-hook.js";
//   const r = await askGreenPoints(studentId);   // { greenCode } or throws
//   // then place the food order, with r.greenCode (null if skipped)
//
// Rejects with Error("CANCELLED") if the student closes the question, so no order is placed.
import { getGreenItems, getGreenRules, submitGreen, dailyItemsUsed, isValidStudentId } from "./green.js";

const CSS_URL = new URL("green.css", import.meta.url).href;

function ensureCss() {
  if (document.querySelector("link[data-gp-css]")) return;
  const l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = CSS_URL;
  l.setAttribute("data-gp-css", "");
  document.head.appendChild(l);
}

const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

const ERRORS = {
  INVALID_SID: "Enter a valid student ID first.",
  NO_ITEMS: "Pick at least one item, or skip Green Points.",
  ITEM_NOT_AVAILABLE: "One item is no longer available. Please try again.",
  BAD_QTY: "Quantity must be between 1 and 20.",
  DAILY_LIMIT: "Daily limit reached for this student. You can skip Green Points."
};

export function askGreenPoints(studentId) {
  if (!isValidStudentId(studentId)) return Promise.reject(new Error("INVALID_SID"));
  ensureCss();

  return new Promise((resolve, reject) => {
    const root = document.createElement("div");
    root.className = "green-page gp-hook";
    root.innerHTML = `
      <div class="gp-overlay open" role="dialog" aria-modal="true" aria-labelledby="gph-title">
        <div class="gp-sheet" id="gph-sheet"></div>
      </div>`;
    document.body.appendChild(root);
    const sheet = root.querySelector("#gph-sheet");

    let picks = {};
    let items = [];
    let rules = { coinTk: 1, maxPct: 30, dailyCap: 20 };
    let used = 0;
    let busy = false;

    function finish(fn, value) {
      root.remove();
      document.removeEventListener("keydown", onKey);
      fn(value);
    }
    function onKey(e) { if (e.key === "Escape") finish(reject, new Error("CANCELLED")); }
    document.addEventListener("keydown", onKey);

    root.querySelector(".gp-overlay").addEventListener("click", e => {
      if (e.target === e.currentTarget) finish(reject, new Error("CANCELLED"));
    });

    // ---- step 1: the question ----
    function showQuestion() {
      sheet.innerHTML = `
        <button class="ghost xs x" data-k="close" aria-label="Close">Close</button>
        <div class="eyebrow">Green Points</div>
        <h2 id="gph-title" style="margin-top:2px">Add Green Points to this order?</h2>
        <p class="muted small">Bring empty bottles or containers to the counter and get coins. Coins can lower your next bill.</p>
        <div class="choice">
          <button data-k="yes">Yes, add items</button>
          <button class="ghost" data-k="no">No, just order</button>
        </div>`;
      sheet.querySelector('[data-k="close"]').onclick = () => finish(reject, new Error("CANCELLED"));
      sheet.querySelector('[data-k="yes"]').onclick = showPicker;
      sheet.querySelector('[data-k="no"]').onclick = () => finish(resolve, { greenCode: null });
    }

    // ---- step 2: pick items ----
    async function showPicker() {
      sheet.innerHTML = `<div class="muted small">Loading items...</div>`;
      try {
        [rules, items] = await Promise.all([getGreenRules(), getGreenItems()]);
        used = await dailyItemsUsed(studentId);
      } catch (err) {
        console.error(err);
        sheet.innerHTML = `<p class="err">Could not load Green Points. Check your connection.</p>
          <div class="choice"><button class="ghost" data-k="skip">Skip, just order</button></div>`;
        sheet.querySelector('[data-k="skip"]').onclick = () => finish(resolve, { greenCode: null });
        return;
      }
      drawPicker();
    }

    function totals() {
      let count = 0, coins = 0;
      items.forEach(i => { const n = picks[i.id] || 0; count += n; coins += n * i.coins; });
      return { count, coins };
    }

    function drawPicker() {
      const t = totals();
      const over = used + t.count > rules.dailyCap;
      const list = items.length
        ? items.map(i => {
            const n = picks[i.id] || 0;
            return `<div class="item ${n ? "on" : ""}">
              <div class="name">${esc(i.name)}</div>
              <div><span class="coinpill">${i.coins} coin${i.coins > 1 ? "s" : ""}</span></div>
              <div class="qty">
                <button class="ghost round" data-minus="${esc(i.id)}" aria-label="Remove one">−</button>
                <span class="q">${n}</span>
                <button class="round" data-plus="${esc(i.id)}" aria-label="Add one">+</button>
              </div></div>`;
          }).join("")
        : `<div class="muted small">No items are open for Green Points right now.</div>`;

      sheet.innerHTML = `
        <button class="ghost xs x" data-k="close" aria-label="Close">Close</button>
        <div class="eyebrow">Green Points</div>
        <h2 id="gph-title" style="margin-top:2px">What are you bringing?</h2>
        <p class="hint">Staff checks them at the counter. Coins are added after approval.</p>
        <div class="items" style="grid-template-columns:1fr 1fr">${list}</div>
        <p class="hint" style="margin-top:8px">${used}/${rules.dailyCap} items used today · you will get ${t.coins} coins</p>
        <p class="err">${over ? ERRORS.DAILY_LIMIT : ""}</p>
        <div class="choice">
          <button data-k="submit" ${t.count === 0 || over || busy ? "disabled" : ""}>Submit and place order</button>
          <button class="ghost" data-k="skip">Skip, just order</button>
        </div>`;

      sheet.querySelector('[data-k="close"]').onclick = () => finish(reject, new Error("CANCELLED"));
      sheet.querySelector('[data-k="skip"]').onclick = () => finish(resolve, { greenCode: null });
      sheet.querySelector('[data-k="submit"]')?.addEventListener("click", submit);
      sheet.querySelectorAll("[data-plus]").forEach(b => b.onclick = () => {
        const id = b.dataset.plus; picks[id] = Math.min((picks[id] || 0) + 1, 20); drawPicker();
      });
      sheet.querySelectorAll("[data-minus]").forEach(b => b.onclick = () => {
        const id = b.dataset.minus; picks[id] = Math.max((picks[id] || 0) - 1, 0);
        if (!picks[id]) delete picks[id];
        drawPicker();
      });
    }

    async function submit() {
      if (busy) return;
      busy = true;
      try {
        const code = await submitGreen(studentId, picks);
        finish(resolve, { greenCode: code });
      } catch (err) {
        console.error(err);
        busy = false;
        const msg = ERRORS[err.message] || "Could not submit. Please try again.";
        drawPicker();
        const p = sheet.querySelector(".err");
        if (p) p.textContent = msg;
      }
    }

    showQuestion();
  });
}