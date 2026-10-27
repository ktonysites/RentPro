// Sends signed-out visitors to the login page. Load after js/dev-auth.js as a module.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-app.js";
import { getAuth, onAuthStateChanged as firebaseOnAuthStateChanged, signOut as firebaseSignOut } from "https://www.gstatic.com/firebasejs/10.7.1/firebase-auth.js";

const firebaseConfig = { apiKey: "AIzaSyBwJEOW3jVBHLizWiJjT4a_Tay-2yUCZwk", authDomain: "rentpro-saas.firebaseapp.com", projectId: "rentpro-saas" };
const auth = getAuth(initializeApp(firebaseConfig));

RentProDevAuth.onAuthStateChanged(auth, (user) => {
    if (!user) window.location.href = "index.html";
}, firebaseOnAuthStateChanged);

const logoutBtn = document.getElementById("logoutBtn");
if (logoutBtn) logoutBtn.addEventListener("click", () => RentProDevAuth.signOut(auth, firebaseSignOut));
