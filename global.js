/* ============================================================
   GLOBAL CONFIGURATION
   ============================================================ */

// 🔗 Your NEW deployed Google Apps Script URL
const API_URL = "https://script.google.com/macros/s/AKfycbzsWx1USYqSBOGLttP8GibfJdSfRLu9bDGSGiuOGj1TuI88gH7nTXJTZqy0Iwd3oMg2_w/exec";

// Local storage keys
const KEY_TENANTS = "rentpro_tenants_v1";
const KEY_PAYMENTS = "rentpro_payments_v1";
const KEY_EXPENSES = "rentpro_expenses_v1";
const KEY_UNSYNCED = "rentpro_unsynced_v1";

// Short helper to select IDs
const $ = (id) => document.getElementById(id);

/* ============================================================
   API WRAPPER (Handles GET/POST & Offline)
   ============================================================ */

/**
 * Universal Fetch Function
 * @param {Object} params - Query parameters (e.g., { action: 'getTenants' })
 * @param {String} method - 'GET' or 'POST'
 * @param {Object} body - Data object to send (only for POST)
 */
async function apiFetch(params = {}, method = "GET", body = null) {
    try {
        const url = new URL(API_URL);
        
        // Add query parameters to URL (for routing)
        Object.entries(params).forEach(([key, val]) => url.searchParams.append(key, val));

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000); // 10s timeout

        const options = {
            method: method,
            signal: controller.signal,
        };

        // If POST, attach the body as plain text to avoid CORS preflight issues
        if (method === "POST" && body) {
            options.headers = { "Content-Type": "text/plain;charset=utf-8" };
            options.body = JSON.stringify(body);
        }

        const response = await fetch(url, options);
        clearTimeout(timeout);

        if (!response.ok) throw new Error("HTTP Error: " + response.status);

        return await response.json();

    } catch (error) {
        console.warn("API Offline or Error:", error);
        return { success: false, offline: true, error: error.message };
    }
}

/* ============================================================
   LOCAL STORAGE HELPERS
   ============================================================ */

function saveLocal(key, value) {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
        console.error("Save Local Error", e);
    }
}

function loadLocal(key, fallback = []) {
    try {
        const stored = localStorage.getItem(key);
        return stored ? JSON.parse(stored) : fallback;
    } catch (e) {
        console.error("Load Local Error:", e);
        return fallback;
    }
}

/* ============================================================
   SHARED UTILITY FUNCTIONS
   ============================================================ */

function formatMoney(amount) {
    amount = Number(amount || 0);
    return new Intl.NumberFormat("en-KE", {
        style: "currency",
        currency: "KES", 
        minimumFractionDigits: 0
    }).format(amount).replace("KES", "").trim();
}

function escapeHtml(str) {
    if (str == null) return ""; 
    return String(str).replace(/[&<>"']/g, (c) => ({ 
        "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
}

/* ============================================================
   OFFLINE SYNC QUEUE (Automatic)
   ============================================================ */

// Run Sync
async function tryAutoSync() {
    const queue = loadLocal(KEY_UNSYNCED, []);
    if (queue.length === 0) return;

    console.log(`Attempting to sync ${queue.length} items...`);
    const remaining = [];

    for (let item of queue) {
        const res = await apiFetch({ action: item.action }, "POST", item.payload);
        if (res.success) {
            console.log("Synced successfully:", item.action);
        } else {
            remaining.push(item);
        }
    }
    saveLocal(KEY_UNSYNCED, remaining);
}

// Trigger sync when internet comes back
window.addEventListener("online", tryAutoSync);
if (navigator.onLine) setTimeout(tryAutoSync, 3000);