// Shared sign-in helpers loaded by every page:
//  - the local development login (http://localhost dev server only),
//  - the allow-list for Google accounts,
//  - signing out of the native Google session inside the Android app.
(function () {
    const localHosts = new Set(['localhost', '127.0.0.1', '[::1]']);
    // Only the plain-http dev server. The Android app also runs at https://localhost and must use real Firebase sign-in.
    const enabled = localHosts.has(window.location.hostname) && window.location.protocol === 'http:' && !window.Capacitor;
    const sessionKey = 'rentpro_local_dev_user';
    const deniedKey = 'rentpro_auth_denied';
    const devCredentials = {
        email: 'dev@rentpro.local',
        password: 'RentProDev2026!'
    };

    // Google sign-in lets any Google account create a Firebase user, so only these addresses may use it.
    // Email/password accounts are created in the Firebase console and are not limited by this list.
    const GOOGLE_ALLOWED_EMAILS = ['ken05462@gmail.com', 'nancyngari2@gmail.com'];

    function signedInWithGoogle(user) {
        return (user.providerData || []).some((profile) => profile.providerId === 'google.com');
    }

    function isAllowedUser(user) {
        if (!user || !signedInWithGoogle(user)) return true;
        return GOOGLE_ALLOWED_EMAILS.includes(String(user.email || '').trim().toLowerCase());
    }

    // The Android app's native Google sign-in plugin; null in browsers or until google-services.json is added.
    function nativeAuth() {
        return window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform()
            ? (window.Capacitor.Plugins.FirebaseAuthentication || null)
            : null;
    }

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
        isAllowedUser,
        nativeAuth,
        // Email of a Google account that was just refused, shown once on the login page.
        takeDeniedEmail() {
            const email = sessionStorage.getItem(deniedKey);
            sessionStorage.removeItem(deniedKey);
            return email;
        },
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

            return firebaseOnAuthStateChanged(auth, (user) => {
                if (user && !isAllowedUser(user)) {
                    // A Google account that is not on the list: end its session and treat the visitor as signed out.
                    sessionStorage.setItem(deniedKey, user.email || 'That Google account');
                    auth.signOut();
                    const native = nativeAuth();
                    if (native) native.signOut().catch(() => {});
                    return callback(null);
                }
                announce(user);
            });
        },
        signOut(auth, firebaseSignOut) {
            if (getCurrentUser()) {
                sessionStorage.removeItem(sessionKey);
                window.location.href = 'index.html';
                return Promise.resolve();
            }

            // In the Android app also forget the Google account chosen on the device.
            const native = nativeAuth();
            if (native) native.signOut().catch(() => {});
            return firebaseSignOut(auth);
        }
    };
})();
