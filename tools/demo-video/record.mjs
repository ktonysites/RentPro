// Records every scene in script.json from the demo server (node demo-server.cjs) into out/clips/<id>.webm.
// Each scene is paced to its voice-over length (out/voice/durations.json, made by voice.mjs).
// Usage: node record.mjs [sceneId ...]   (no ids = all scenes, in order)
import puppeteer from "puppeteer-core";
import ffmpegPath from "ffmpeg-static";
import fs from "node:fs";

const BASE = "http://localhost:5502";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const TAIL = 0.8; // seconds of picture after the narration ends (covers the cross-fade)
const script = JSON.parse(fs.readFileSync("script.json", "utf8"));
const durations = JSON.parse(fs.readFileSync("out/voice/durations.json", "utf8"));
const only = process.argv.slice(2);
fs.mkdirSync("out/clips", { recursive: true });

// The local test login lives in the project's dev-auth.js (localhost only).
const devAuth = fs.readFileSync("../../js/dev-auth.js", "utf8");
const DEV_EMAIL = devAuth.match(/email: '([^']+)'/)[1];
const DEV_PASSWORD = devAuth.match(/password: '([^']+)'/)[1];

// Pointer, click ripple and scene label, drawn on every page so they show in the recording.
const OVERLAY = `
(() => {
  if (window.top !== window) return; // the phone mock-up embeds the app: draw the overlay only once
  const install = () => {
    if (document.getElementById('demo-cursor') || !document.body) return;
    const style = document.createElement('style');
    style.textContent = \`
      #demo-cursor { position: fixed; left: 0; top: 0; width: 26px; height: 26px; z-index: 2147483647; pointer-events: none;
        transition: transform .55s cubic-bezier(.3,.7,.2,1); filter: drop-shadow(0 2px 3px rgba(0,0,0,.35)); }
      .demo-ripple { position: fixed; width: 44px; height: 44px; margin: -22px 0 0 -22px; border-radius: 50%; z-index: 2147483646;
        pointer-events: none; background: rgba(99,102,241,.35); border: 2px solid rgba(99,102,241,.8); animation: demo-ripple .6s ease-out forwards; }
      @keyframes demo-ripple { from { transform: scale(.3); opacity: 1; } to { transform: scale(1.6); opacity: 0; } }
      #demo-label { position: fixed; left: 0; right: 0; width: max-content; margin: 0 auto; bottom: 22px; z-index: 2147483645; pointer-events: none; display: flex; align-items: center; gap: 10px;
        background: rgba(17,16,48,.86); color: #fff; font: 600 17px Inter, 'Segoe UI', sans-serif; padding: 10px 18px 10px 12px; border-radius: 14px;
        box-shadow: 0 10px 30px rgba(0,0,0,.25); opacity: 0; transform: translateY(12px); transition: opacity .5s, transform .5s; }
      #demo-label.show { opacity: 1; transform: none; }
      #demo-label b { background: linear-gradient(135deg,#8b5cf6,#4f46e5); border-radius: 8px; padding: 3px 9px; font-size: 14px; }
      .demo-highlight { outline: 3px solid #f59e0b !important; outline-offset: 3px; border-radius: 8px; transition: outline-color .3s; }
      #demo-sms { position: fixed; top: 22px; right: 22px; width: 380px; z-index: 2147483644; background: #fff; color: #111; border-radius: 18px;
        box-shadow: 0 18px 50px rgba(0,0,0,.3); padding: 16px 18px; font: 14px/1.45 Inter, 'Segoe UI', sans-serif;
        transform: translateX(440px); transition: transform .6s cubic-bezier(.2,.8,.2,1); }
      #demo-sms.show { transform: none; }
      #demo-sms .h { display: flex; align-items: center; gap: 10px; font-weight: 700; margin-bottom: 6px; }
      #demo-sms .ic { width: 30px; height: 30px; border-radius: 8px; background: #16a34a; color: #fff; display: grid; place-items: center; font-weight: 800; }
    \`;
    document.head.appendChild(style);
    const cursor = document.createElement('div');
    cursor.id = 'demo-cursor';
    cursor.innerHTML = '<svg viewBox="0 0 24 24" width="26" height="26"><path d="M4 2l15 11-6.5 1.2L16 21l-3 1.4-3.4-7L4 19z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>';
    const pos = JSON.parse(sessionStorage.getItem('demoCursor') || '[640,360]');
    cursor.style.transition = 'none';
    cursor.style.transform = 'translate(' + pos[0] + 'px,' + pos[1] + 'px)';
    document.body.appendChild(cursor);
    requestAnimationFrame(() => { cursor.style.transition = ''; });
    const label = document.createElement('div');
    label.id = 'demo-label';
    document.body.appendChild(label);
    const text = sessionStorage.getItem('demoLabel');
    if (text) { label.innerHTML = text; requestAnimationFrame(() => label.classList.add('show')); }
  };
  window.__demoMove = (x, y, ms) => {
    install();
    const c = document.getElementById('demo-cursor');
    c.style.transitionDuration = (ms || 550) + 'ms';
    c.style.transform = 'translate(' + x + 'px,' + y + 'px)';
    sessionStorage.setItem('demoCursor', JSON.stringify([x, y]));
  };
  window.__demoClick = (x, y) => {
    const r = document.createElement('div');
    r.className = 'demo-ripple'; r.style.left = x + 'px'; r.style.top = y + 'px';
    document.body.appendChild(r); setTimeout(() => r.remove(), 700);
  };
  window.__demoLabel = (html) => {
    install();
    sessionStorage.setItem('demoLabel', html || '');
    const l = document.getElementById('demo-label');
    l.classList.remove('show');
    if (html) { l.innerHTML = html; requestAnimationFrame(() => requestAnimationFrame(() => l.classList.add('show'))); }
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1.5 },
  args: ["--hide-scrollbars", "--disable-features=Translate", "--no-first-run", "--force-color-profile=srgb", "--lang=en-GB"]
});
const page = await browser.newPage();
await page.evaluateOnNewDocument(OVERLAY);
page.on("dialog", (dialog) => dialog.accept());
page.on("pageerror", (error) => console.log("  page error:", error.message));

let cursor = [640, 360];
const d = {
  page,
  async goto(path) {
    await page.goto(BASE + path, { waitUntil: "networkidle2" });
    await sleep(500);
  },
  async el(selector, frame = page) {
    const handle = typeof selector === "string" ? await frame.waitForSelector(selector, { visible: true, timeout: 10000 }) : selector;
    // Scroll only when the element is not comfortably on screen.
    const visible = await handle.evaluate((e) => { const r = e.getBoundingClientRect(); const h = window.innerHeight; return r.top >= 60 && r.bottom <= h - 60; });
    if (!visible) { await handle.evaluate((e) => e.scrollIntoView({ block: "center", behavior: "smooth" })); await sleep(450); }
    return handle;
  },
  async moveTo(selector, frame = page) {
    const handle = await d.el(selector, frame);
    const box = await handle.boundingBox();
    const x = Math.round(box.x + Math.min(box.width / 2, 60)), y = Math.round(box.y + box.height / 2);
    await page.evaluate((x, y) => window.__demoMove(x, y, 600), x, y);
    await page.mouse.move(x, y, { steps: 12 });
    cursor = [x, y];
    await sleep(480);
    return handle;
  },
  async click(selector, frame = page) {
    const handle = await d.moveTo(selector, frame);
    await page.evaluate((x, y) => window.__demoClick(x, y), cursor[0], cursor[1]);
    await sleep(120);
    await handle.evaluate((e) => { if (e.focus) e.focus(); e.click(); });
    await sleep(350);
    return handle;
  },
  async type(selector, text, { clear = false, delay = 32 } = {}) {
    const handle = await d.click(selector);
    if (clear) await handle.evaluate((e) => { e.value = ""; e.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.keyboard.type(text, { delay });
    await sleep(250);
    return handle;
  },
  async select(selector, value) {
    await d.click(selector);
    await page.select(selector, value);
    await sleep(500);
  },
  async scrollTo(selector) { await d.el(selector); await sleep(400); },
  async byText(selector, text) {
    return page.waitForFunction((s, t) => [...document.querySelectorAll(s)].find((e) => e.offsetParent && e.textContent.includes(t)), { timeout: 10000 }, selector, text);
  },
  async highlight(selector, on = true) {
    await page.evaluate((s, on) => { const e = typeof s === "string" ? document.querySelector(s) : null; if (e) e.classList.toggle("demo-highlight", on); }, selector, on);
  },
  async label(text) { await page.evaluate((t) => window.__demoLabel(t), text); },
  sleep
};

async function record(scene, run) {
  const voice = durations[scene.id];
  const file = `out/clips/${scene.id}.webm`;
  const recorder = await page.screencast({ path: file, ffmpegPath, fps: 30, quality: 18, scale: 1.5 });
  const start = Date.now();
  d.at = async (fraction) => { const wait = start + fraction * voice * 1000 - Date.now(); if (wait > 0) await sleep(wait); };
  try {
    await run();
  } finally {
    const left = start + (voice + TAIL) * 1000 - Date.now();
    if (left > 0) await sleep(left);
    else console.log(`  ! ${scene.id} ran ${(-left / 1000).toFixed(1)}s past its narration`);
    await recorder.stop();
  }
  console.log(`  ✓ ${scene.id} (${((Date.now() - start) / 1000).toFixed(1)}s, voice ${voice.toFixed(1)}s)`);
}

const tag = (n, text) => `<b>${n}</b>${text}`;
const sceneNumber = (id) => script.scenes.filter((s) => s.label).findIndex((s) => s.id === id) + 1;

// What happens in each scene. Setup (before recording) is in "prepare"; times are fractions of the voice-over.
const SCENES = {
  intro: { card: true },
  outro: { card: true },

  login: {
    async prepare() {
      await d.goto("/index.html");
      await page.evaluate(() => { sessionStorage.clear(); localStorage.clear(); });
      await d.goto("/index.html");
    },
    async run() {
      await d.at(0.08); await d.moveTo("#googleBtn");
      await d.at(0.42); await d.type("#email", DEV_EMAIL, { delay: 45 });
      await d.at(0.62); await d.type("#password", DEV_PASSWORD, { delay: 45 });
      await d.at(0.82); await d.click("#loginForm button[type=submit]");
    }
  },

  dashboard: {
    async run() {
      await page.waitForSelector("#totalTenants", { visible: true });
      await d.at(0.22); await d.moveTo("#totalTenants");
      await d.at(0.32); await d.moveTo("#totalRent");
      await d.at(0.42); await d.moveTo("#totalCollected");
      await d.at(0.52); await d.moveTo("#totalPayments");
      await d.at(0.62); await d.moveTo("#revenueChart");
      await d.at(0.84); await d.moveTo("#recentActivityList");
    }
  },

  insights: {
    async prepare() { await page.evaluate(() => localStorage.removeItem("rentpro_ai_insights")); await d.goto("/dashboard.html"); await d.el("#aiCard"); },
    async run() {
      await d.at(0.08); await d.click("#aiGenerateBtn");
      await page.waitForSelector("#aiBody > p:nth-of-type(2)", { visible: true, timeout: 20000 });
      const headings = await page.$$("#aiBody > p");
      const marks = [0.2, 0.32, 0.44, 0.52, 0.6, 0.7, 0.8, 0.9];
      for (let i = 0; i < headings.length; i++) { await d.at(marks[Math.min(i, marks.length - 1)]); await d.moveTo(headings[i]); }
    }
  },

  tenants: {
    async prepare() { await page.evaluate(() => localStorage.removeItem("rentpro_tenants_view")); await d.goto("/tenants.html"); },
    async run() {
      await d.at(0.08); await d.moveTo("#statRent");
      await d.at(0.16); await d.moveTo("#statOwed");
      await d.at(0.24); await d.moveTo("#statPaid");
      await d.at(0.36); await d.type("#searchInput", "house 7", { delay: 90 });
      await d.at(0.5); await d.click("#searchClear");
      await d.at(0.56); await d.click('[data-filter="owing"]');
      await d.at(0.64); await d.click('[data-filter="overdue"]');
      await d.at(0.7); await d.click('[data-filter="paid"]');
      await d.at(0.76); await d.click('[data-filter="credit"]');
      await d.at(0.82); await d.click('[data-filter="all"]');
      await d.at(0.86); await d.select("#sortSelect", "balance");
    }
  },

  "add-tenant": {
    async run() {
      await d.at(0.04); await d.click("#newTenantBtn");
      await d.at(0.12); await d.type("#tName", "Esther Wanjiku");
      await d.type("#tPhone", "0711223344");
      await d.type("#tNatID", "34567890");
      await d.at(0.6); await d.type("#tHouse", "7", { delay: 120 });
      await d.moveTo("#houseWarning");
      await d.at(0.78); await d.type("#tHouse", "10", { clear: true, delay: 120 });
      await d.type("#tRent", "7500");
      await d.type("#tNextOfKin", "Paul Wanjiku", { delay: 25 });
      await d.click("#saveBtn");
    }
  },

  "cash-payment": {
    async prepare() { await page.evaluate(() => localStorage.removeItem("rentpro_tenants_view")); await d.goto("/tenants.html"); },
    async run() {
      const row = await d.byText("#tenantTableBody tr", "Peter Otieno");
      const pay = await row.$("button.btn-outline-success");
      await d.at(0.12); await d.click(pay);
      await d.at(0.3); await d.moveTo("#payAmount");
      await d.at(0.5); await d.type("#payAmount", "7000", { clear: true, delay: 110 });
      await d.select("#payMethod", "Cash");
      await d.at(0.78); await d.click("#confirmPayBtn");
    }
  },

  profile: {
    async prepare() { await d.goto("/tenants.html"); },
    async run() {
      const row = await d.byText("#tenantTableBody tr", "Mary Wambui");
      await d.at(0.03); await d.click(row);
      await page.waitForSelector("#profileContent", { visible: true });
      await d.at(0.12); await d.moveTo("#pBal");
      await d.at(0.2); await d.moveTo("#pNextOfKin");
      await d.at(0.27); await d.moveTo("#historyBody");
      await d.at(0.34); await d.moveTo("#utilityBody");
      await d.at(0.42); await d.click('[data-bs-target="#reminderModal"]');
      await d.at(0.52); await d.select("#reminderLang", "Kiswahili");
      await d.click("#reminderGenerate");
      await page.waitForFunction(() => document.getElementById("reminderText").value.length > 20, { timeout: 15000 });
      await d.moveTo("#reminderText");
      await d.at(0.84); await d.moveTo("#reminderSms");
      await d.at(0.92); await d.moveTo("#reminderWhatsapp");
    }
  },

  sms: {
    async prepare() { await d.goto("/payments.html"); },
    async run() {
      await d.at(0.1); await d.moveTo("#statMonth");
      await d.at(0.42);
      const message = `Confirmed. KES. 6,000.00 to NANCYWANJIRUNGARI A/C Ref. No. 275515 4 Via MPESA Ref UKT5MN3QW8 by FAITH CHEBET on ${new Date().toLocaleDateString("en-GB").replace(/\//g, "-")} at 11:05.Thank you.`;
      await page.evaluate((m) => {
        const box = document.createElement("div");
        box.id = "demo-sms";
        box.innerHTML = '<div class="h"><span class="ic">M</span>MPESA · now</div>' + m;
        document.body.appendChild(box);
        requestAnimationFrame(() => requestAnimationFrame(() => box.classList.add("show")));
      }, message);
      await fetch(BASE + "/demo/sms", { method: "POST", body: JSON.stringify({ message }) });
      await d.at(0.68);
      await page.reload({ waitUntil: "networkidle2" });
      await sleep(600);
      const first = await page.waitForSelector("#payList .pay-row, #payList > *", { visible: true });
      await first.evaluate((e) => e.classList.add("demo-highlight"));
      await d.moveTo(first);
      await d.at(0.88); await d.goto("/tenants.html");
      const row = await d.byText("#tenantTableBody tr", "Faith Chebet");
      await row.evaluate((e) => e.classList.add("demo-highlight"));
      await d.moveTo(row);
    }
  },

  payments: {
    async prepare() { await d.goto("/payments.html"); },
    async run() {
      await d.at(0.1); await d.moveTo("#searchInput");
      await d.at(0.2); await d.moveTo("#statusFilter");
      const boxes = await page.$$("#payList input[type=checkbox]:not([disabled])");
      await d.at(0.34); await d.click(boxes[5]);
      await d.click(boxes[6]);
      await d.at(0.45); await d.click("#clearBtn");
      await d.at(0.52); await d.click("#confirmOk");
      await sleep(900);
      await d.at(0.62); await d.click('[data-tab="bin"]');
      await sleep(600);
      const binBoxes = await page.$$("#payList input[type=checkbox]:not([disabled])");
      await d.at(0.72); await d.click(binBoxes[0]);
      if (binBoxes[1]) await d.click(binBoxes[1]);
      await d.at(0.84); await d.click("#restoreBtn");
      const ok = await page.$("#confirmModal.show #confirmOk");
      if (ok) await d.click("#confirmOk");
    }
  },

  unmatched: {
    async prepare() { await d.goto("/reconcile.html"); },
    async run() {
      await d.at(0.08); await d.moveTo("#paymentList");
      await d.at(0.32); await d.click("#aiSuggestBtn");
      const assign = await page.waitForSelector(".ai-slot button", { visible: true, timeout: 20000 });
      await d.at(0.52); await d.moveTo(".ai-slot");
      await d.at(0.68); await d.click(assign);
      await d.at(0.8); await d.moveTo("#houseSelect");
      await d.at(0.88); await d.click("#fixModal .btn-primary.w-100");
    }
  },

  utilities: {
    async prepare() { await d.goto("/utilities.html"); },
    async run() {
      await d.at(0.08); await d.moveTo("#totalUnpaid");
      await d.at(0.28); await d.moveTo("#generateBillsBtn");
      await d.at(0.5); await d.moveTo("#billsTableBody");
      const markPaid = await d.byText("#billsTableBody button", "Mark Paid");
      await d.at(0.78); await d.click(markPaid);
    }
  },

  expenses: {
    async prepare() { await d.goto("/expenses.html"); },
    async run() {
      await d.at(0.05); await d.moveTo("#totalAmount");
      await d.at(0.14); await d.click("#addExpenseBtn");
      await d.at(0.22); await d.type("#expenseDesc", "Fundi repaired leaking tap, nyumba 6", { delay: 40 });
      await d.type("#expenseAmount", "1800");
      await d.at(0.5); await d.click("#aiCategoryBtn");
      await page.waitForFunction(() => document.getElementById("aiCategoryNote").textContent.trim().length > 3, { timeout: 15000 });
      await d.moveTo("#expenseCategory");
      await d.at(0.68); await d.moveTo("#expenseHouse");
      await d.at(0.88); await d.click("#expenseForm button[type=submit]");
    }
  },

  reports: {
    async prepare() { await d.goto("/reports.html"); },
    async run() {
      await d.at(0.04); await d.moveTo("#kExpected");
      await d.at(0.1); await d.moveTo("#kCollected");
      await d.at(0.16); await d.moveTo("#kRate");
      await d.at(0.22); await d.moveTo("#kExpenses");
      await d.at(0.28); await d.moveTo("#kNet");
      await d.at(0.34); await d.moveTo("#kOwed");
      await d.at(0.44); await d.select("#timeRange", "last_3_months");
      await d.at(0.54); await d.select("#timeRange", "this_year");
      await d.at(0.62); await d.moveTo("#trendChart");
      await d.at(0.72); await d.moveTo("#houseBody");
      await d.at(0.82); await d.moveTo("#monthBody");
      await d.at(0.92); await d.moveTo("button[onclick='window.print()']");
    }
  },

  former: {
    async prepare() { await d.goto("/moveout.html"); },
    async run() {
      await d.at(0.04); await d.type("#mName", "Faith Chebet", { delay: 45 });
      await d.type("#mHouse", "4", { delay: 80 });
      await d.type("#mReason", "New job in Nakuru", { delay: 30 });
      await d.at(0.38); await d.click("#mDeposit");
      await page.keyboard.press("Escape").catch(() => {});
      await d.moveTo("button.btn-submit");
      await d.at(0.52); await d.goto("/archives.html");
      await d.at(0.6); await d.moveTo("#archiveTableBody");
      const details = await d.byText("#archiveTableBody tr", "John Kamau");
      await d.at(0.72); await d.click(details);
      await d.at(0.85); await d.moveTo("#paymentLog");
    }
  },

  "pay-lookup": {
    async prepare() { await d.goto("/pay.html"); },
    async run() {
      await d.at(0.1); await d.type("#searchInput", "4", { delay: 150 });
      await d.at(0.3); await d.click("#findBtn");
      await page.waitForSelector("#resultSection", { visible: true, timeout: 10000 });
      await d.at(0.55); await d.moveTo("#dispBalance");
      await d.at(0.75); await d.moveTo("#mpesaAcc");
    }
  },

  assistant: {
    async prepare() {
      await page.evaluate(() => Object.keys(sessionStorage).filter((k) => k.startsWith("rentpro_ai")).forEach((k) => sessionStorage.removeItem(k)));
      await page.evaluate(() => localStorage.removeItem("rentpro_ai_chat"));
      await d.goto("/tenants.html");
    },
    async run() {
      await d.at(0.03); await d.click("#aiFab");
      const action = await d.byText(".ai-action", "behind on rent");
      await d.at(0.1); await d.click(action);
      await page.waitForSelector("#aiLog .ai-bubble", { visible: true, timeout: 15000 });
      await d.at(0.27); await d.goto("/assistant.html");
      await d.click("#newChatBtn").catch(() => {});
      await d.at(0.32); await d.type("#chatInput", "Who is late with rent?", { delay: 45 });
      await page.keyboard.press("Enter");
      await d.at(0.5); await d.type("#chatInput", "How much did I collect last month?", { delay: 40 });
      await page.keyboard.press("Enter");
      await d.at(0.66); await d.type("#chatInput", "Nani hajalipa kodi?", { delay: 55 });
      await page.keyboard.press("Enter");
      await d.at(0.86); await d.moveTo("#engineLabel");
    }
  },

  mobile: {
    async prepare() { await d.goto("/tools/demo-video/phone.html"); await sleep(1500); },
    async run() {
      const frame = await (await page.$("#screen")).contentFrame();
      await d.at(0.12); await d.moveTo(".copy h2");
      await d.at(0.3);
      await frame.evaluate(() => { const s = document.scrollingElement; s.scrollTo({ top: 520, behavior: "smooth" }); document.querySelector("main")?.scrollTo?.({ top: 520, behavior: "smooth" }); });
      await d.at(0.5);
      const tenantsTab = await frame.waitForSelector('.rp-tabbar a[href*="tenants"]', { visible: true });
      await d.click(tenantsTab, frame);
      await d.at(0.78);
      const more = await frame.waitForSelector(".rp-tabbar [data-sheet-open]", { visible: true });
      await d.click(more, frame);
    }
  }
};

for (const scene of script.scenes) {
  if (only.length && !only.includes(scene.id)) continue;
  const plan = SCENES[scene.id];
  if (plan.card) {
    const q = new URLSearchParams({ title: scene.card.title, subtitle: scene.card.subtitle,
      tags: scene.id === "intro" ? "Tenants|M-Pesa payments|Utilities|Expenses|Reports|AI assistant" : "ktonysites.github.io/RentPro" });
    await page.evaluate(() => sessionStorage.removeItem("demoLabel")).catch(() => {});
    await page.goto(`${BASE}/tools/demo-video/card.html?${q}`, { waitUntil: "networkidle2" });
    await page.evaluate(() => { const c = document.getElementById("demo-cursor"); if (c) c.style.display = "none"; });
    await sleep(400);
    await record(scene, async () => { await sleep(150); await page.evaluate(() => window.startCard()); });
    continue;
  }
  if (plan.prepare) await plan.prepare();
  await d.label(tag(sceneNumber(scene.id), scene.label));
  await sleep(300);
  try {
    await record(scene, plan.run);
  } catch (error) {
    console.log(`  ✗ ${scene.id}: ${error.message}`);
    await page.screenshot({ path: `out/clips/${scene.id}-error.png` });
  }
}
await browser.close();
