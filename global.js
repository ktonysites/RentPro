/* Central application configuration. Update the Apps Script deployment URL here. */
window.API_URL = "https://script.google.com/macros/s/AKfycbwBly-iQTvSU8iPkCQyD0wi-5tSA64ECeKMb1_1Lkuu5vnmptkkWacIAqSqH6l1eaXvtw/exec";

// Google Apps Script may redirect GET responses to a URL with mismatched CORS headers.
// JSONP lets read-only requests load through a script tag without that browser restriction.
const nativeFetch = window.fetch.bind(window);
window.fetch = function (resource, options) {
	const requestUrl = typeof resource === "string" ? resource : resource && (resource.url || resource.href);
	const method = (options && options.method) || (resource && resource.method) || "GET";
	if (!requestUrl || method.toUpperCase() !== "GET" || !requestUrl.startsWith(window.API_URL)) {
		return nativeFetch(resource, options);
	}

	return new Promise((resolve, reject) => {
		const callbackName = "rentProJsonp_" + Date.now() + Math.floor(Math.random() * 1000);
		const script = document.createElement("script");
		const url = new URL(requestUrl);
		url.searchParams.set("callback", callbackName);

		const cleanup = () => {
			delete window[callbackName];
			script.remove();
		};
		window[callbackName] = (data) => {
			cleanup();
			resolve(new Response(JSON.stringify(data), {
				status: 200,
				headers: { "Content-Type": "application/json" }
			}));
		};
		script.onerror = () => {
			cleanup();
			reject(new TypeError("Unable to load the Apps Script API"));
		};
		script.src = url.toString();
		document.head.appendChild(script);
	});
};

// Installable web app (not needed inside the Android app, which bundles its own files).
if ("serviceWorker" in navigator && location.protocol === "https:" && !window.Capacitor) {
	window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

const KEY_TENANTS = "rentpro_tenants_v1";

function loadLocal(key, fallback = []) {
	try {
		const stored = localStorage.getItem(key);
		return stored ? JSON.parse(stored) : fallback;
	} catch (error) {
		console.error("Load Local Error", error);
		return fallback;
	}
}

function formatMoney(amount) {
	return Number(amount || 0).toLocaleString("en-KE");
}

// Escapes sheet values before they are placed in innerHTML.
function escapeHtml(input) {
	return String(input ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

// Renders AI replies: escapes everything first, then allows **bold**, _italic_, "# headings" and "- " bullet lists.
function renderAiText(text) {
	const inline = (line) => escapeHtml(line)
		.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
		.replace(/(^|\s)_(.+?)_(?=\s|$|[.,!?])/g, "$1<em>$2</em>");
	const html = [];
	let list = null;
	const closeList = () => { if (list) { html.push(`<ul>${list.join("")}</ul>`); list = null; } };
	String(text || "").split(/\r?\n/).forEach((raw) => {
		const line = raw.trim();
		const bullet = line.match(/^[-*•]\s+(.*)$/) || line.match(/^\d+[.)]\s+(.*)$/);
		if (bullet) { (list = list || []).push(`<li>${inline(bullet[1])}</li>`); return; }
		closeList();
		if (!line) return;
		const heading = line.match(/^#{1,4}\s+(.*)$/);
		html.push(heading ? `<p class="ai-heading"><strong>${inline(heading[1])}</strong></p>` : `<p>${inline(line)}</p>`);
	});
	closeList();
	return html.join("");
}

// Keeps the navigation's unmatched-payments badge in step with a freshly loaded count.
function updateUnmatchedBadge(count) {
	try { sessionStorage.setItem("rentpro_unmatched", JSON.stringify({ at: Date.now(), count })); } catch (error) { /* storage is optional */ }
	if (window.RentProShell) window.RentProShell.showUnmatched(count);
}

// Sends any API action as a GET (POSTs to Apps Script fail CORS in the browser).
// Nested data such as bulk rows travels as a JSON "payload" parameter.
async function apiRequest(params) {
	const url = new URL(window.API_URL);
	const nested = Object.values(params).some((item) => item !== null && typeof item === "object");
	if (nested) {
		url.searchParams.set("payload", JSON.stringify(params));
	} else {
		Object.entries(params).forEach(([key, item]) => url.searchParams.set(key, item ?? ""));
	}
	url.searchParams.set("t", Date.now());
	const response = await fetch(url.toString());
	const result = await response.json();
	if (result && result.success === false) throw new Error(result.message || "Request failed.");
	return result;
}

// AI requests with a time limit: if Gemini/Claude hasn't answered in 25 seconds, the built-in
// assistant answers instead (engine=free), so the landlord is never left waiting.
const AI_TIME_LIMIT_MS = 25000;
async function aiRequest(params) {
	let timer;
	const slow = new Promise((resolve) => { timer = setTimeout(() => resolve(null), AI_TIME_LIMIT_MS); });
	const result = await Promise.race([apiRequest(params), slow]).finally(() => clearTimeout(timer));
	if (result) return result;
	const fallback = await apiRequest({ ...params, engine: "free" });
	if (fallback && fallback.data) fallback.data.notice = "The AI service was slow to reply, so the built-in assistant answered.";
	return fallback;
}
