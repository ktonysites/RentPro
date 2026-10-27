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
