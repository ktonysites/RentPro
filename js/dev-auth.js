// Local development authentication for testing without a production Firebase account.
(function () {
    const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
    // Only the plain-http dev server. The Android app also runs at https://localhost and must use real Firebase sign-in.
    const enabled = localHosts.has(window.location.hostname) && window.location.protocol === 'http:' && !window.Capacitor;
    const sessionKey = 'rentpro_local_dev_user';
    const devCredentials = {
        email: 'dev@rentpro.local',
        password: 'RentProDev2026!'
    };

    function getCurrentUser() {
        if (!enabled) return null;

        try {
            return JSON.parse(sessionStorage.getItem(sessionKey));
        } catch {
            sessionStorage.removeItem(sessionKey);
            return null;
        }
    }

    window.RentProDevAuth = {
        enabled,
        credentials: enabled ? { ...devCredentials } : null,
        signIn(email, password) {
            if (!enabled || email !== devCredentials.email || password !== devCredentials.password) {
                return false;
            }

            sessionStorage.setItem(sessionKey, JSON.stringify({
                uid: 'local-development-user',
                email: devCredentials.email,
                displayName: 'Local Developer'
            }));
            window.location.href = 'dashboard.html';
            return true;
        },
        onAuthStateChanged(auth, callback, firebaseOnAuthStateChanged) {
            // Also tell the navigation shell who is signed in.
            const announce = (user) => {
                if (user) window.dispatchEvent(new CustomEvent('rentpro:user', { detail: { email: user.email, displayName: user.displayName } }));
                callback(user);
            };
            const localUser = getCurrentUser();
            if (localUser) {
                queueMicrotask(() => announce(localUser));
                return () => {};
            }

            return firebaseOnAuthStateChanged(auth, announce);
        },
        signOut(auth, firebaseSignOut) {
            if (getCurrentUser()) {
                sessionStorage.removeItem(sessionKey);
                window.location.href = 'index.html';
                return Promise.resolve();
            }

            return firebaseSignOut(auth);
        }
    };
})();
