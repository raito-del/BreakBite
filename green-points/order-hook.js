// green-points/order-hook.js
// Two popups for student.html:
//   askUseCoins(sid, payableTk)  -> "Use your Green Points coins?"  resolves { coins }
//   askGreenPoints(sid)          -> "Add Green Points to this order?" resolves { greenCode }
// Both reject with Error("CANCELLED") when the student closes them, so no order is placed.
import {
  getGreenItems, getGreenRules, getWallet, submitGreen, dailyItemsUsed, isValidStudentId
} from "./green.js";

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

// ============================================================
// 1. Use coins on this order (discount)
// ============================================================
// payableTk: the amount the student would pay before coins (after promo).
// Resolves { coins } with the number of coins to use (0 = none).
export async function askUseCoins(studentId, payableTk) {
  if (!isValidStudentId(studentId)) return { coins: 0 };

  const [rules, wallet] = await Promise.all([getGreenRules(), getWallet(studentId)]);
  const balance = wallet.balance || 0;
  const payable = Math.max(0, Math.round(Number(payableTk) || 0));
  const maxUse = Math.max(0, Math.min(
    balance,
    Math.floor(payable * rules.maxPct / 100),
    Math.floor(payable / rules.coinTk)
  ));

  // nothing to offer: resolve at once, no popup
  if (balance <= 0 || maxUse <= 0) return { coins: 0 };

  ensureCss();

  return new Promise((resolve, reject) => {
    const root = document.createElement("div");
    root.className = "green-page gp-hook";
    root.innerHTML = `
      <div class="gp-overlay open" role="dialog" aria-modal="true" aria-labelledby="guc-title">
        <div class="gp-sheet">
          <button class="ghost xs x" data-k="close" aria-label="Close">Close</button>
          <div class="eyebrow">Green Points</div>
          <h2 id="guc-title" style="margin-top:2px">Use your coins on this order?</h2>
          <p class="muted small" style="margin:4px 0 10px">
            You have <b>${balance}</b> coins (worth ${Math.round(balance * rules.coinTk)} Tk).
            You can use up to <b>${maxUse}</b> coins on this order.
          </p>

          <div class="choice" style="justify-content:flex-start;margin-top:0">
            <button class="ghost xs" data-pct="25">25%</button>
            <button class="ghost xs" data-pct="50">50%</button>
            <button class="ghost xs" data-pct="75">75%</button>
            <button class="ghost xs" data-pct="100">Max</button>
            <button class="ghost xs" data-pct="0">Zero</button>
          </div>

          <div style="display:flex;gap:8px;align-items:center;margin:10px 0 4px;flex-wrap:wrap">
            <label class="small">Coins to use
              <input id="guc-coins" type="number" min="0" max="${maxUse}" value="0" style="width:110px;margin-left:6px">
            </label>
          </div>

          <div class="row"><span>Discount</span><b class="green" id="guc-off">0 Tk</b></div>
          <div class="row"><span>Discount on bill</span><b id="guc-pct">0%</b></div>
          <div class="row"><span>New total</span><b id="guc-total">${payable} Tk</b></div>

          <div class="choice">
            <button class="ghost" data-k="none">Don't use coins</button>
            <button data-k="ok" id="guc-ok">Don't use coins</button>
          </div>
        </div>
      </div>`;
    document.body.appendChild(root);

    const coinsInput = root.querySelector("#guc-coins");

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

    function currentCoins() {
      let n = parseInt(coinsInput.value, 10);
      if (isNaN(n) || n < 0) n = 0;
      if (n > maxUse) n = maxUse;
      return n;
    }

    function update() {
      const n = currentCoins();
      const off = n * rules.coinTk;
      root.querySelector("#guc-off").textContent = off + " Tk";
      root.querySelector("#guc-pct").textContent = payable ? Math.round(off / payable * 100) + "%" : "0%";
      root.querySelector("#guc-total").textContent = (payable - off) + " Tk";
      root.querySelector("#guc-ok").textContent = n ? "Use " + n + " coins" : "Don't use coins";
    }

    coinsInput.addEventListener("input", update);

    // percent of the student's balance (capped at what this order allows)
    root.querySelectorAll("[data-pct]").forEach(b => b.addEventListener("click", () => {
      const pct = parseInt(b.dataset.pct, 10);
      const n = Math.min(maxUse, Math.floor(balance * pct / 100));
      coinsInput.value = n;
      update();
    }));

    root.querySelector('[data-k="close"]').onclick = () => finish(reject, new Error("CANCELLED"));
    root.querySelector('[data-k="none"]').onclick = () => finish(resolve, { coins: 0 });
    root.querySelector('[data-k="ok"]').onclick = () => finish(resolve, { coins: currentCoins() });

    update();
    setTimeout(() => coinsInput.focus(), 50);
  });
}

// ============================================================
// 2. Add Green Points (bring items, get a G-code)
// ============================================================
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