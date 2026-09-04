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
