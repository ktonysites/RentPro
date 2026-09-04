/* Central application configuration. Update the Apps Script deployment URL here. */
window.API_URL = "https://script.google.com/macros/s/AKfycbwBly-iQTvSU8iPkCQyD0wi-5tSA64ECeKMb1_1Lkuu5vnmptkkWacIAqSqH6l1eaXvtw/exec";

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
