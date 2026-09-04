/* Central application configuration. Update the Apps Script deployment URL here. */
window.API_URL = "https://script.google.com/macros/s/AKfycbzsWx1USYqSBOGLttP8GibfJdSfRLu9bDGSGiuOGj1TuI88gH7nTXJTZqy0Iwd3oMg2_w/exec";

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
