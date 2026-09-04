// Simple auth using localStorage + sessionStorage.
// Works with flat folder structure (all HTML files in the root folder).

(function () {

    // -------------------------------
    // CREATE DEFAULT ADMIN USER
    // -------------------------------
    const usersKey = 'rms_users';
    let users = JSON.parse(localStorage.getItem(usersKey)) || [];

    if (!users.length) {
        users = [{
            email: 'admin@rentpro',
            password: 'password123',
            name: 'Administrator'
        }];
        localStorage.setItem(usersKey, JSON.stringify(users));
    }

    // -------------------------------
    // LOGIN PAGE HANDLING (index.html)
    // -------------------------------
    const loginForm = document.getElementById('loginForm');

    if (loginForm) {

        loginForm.addEventListener('submit', (e) => {
            e.preventDefault();

            const email = document.getElementById('email').value.trim();
            const password = document.getElementById('password').value;

            const u = users.find(x => x.email === email && x.password === password);

            if (u) {
                sessionStorage.setItem('rms_currentUser', JSON.stringify(u));
                window.location = "dashboard.html";
            } else {
                const a = document.getElementById('loginAlert');
                a.textContent = "Invalid email or password";
                a.classList.remove("d-none");
            }
        });

        // RESET ALL LOCAL DATA
        document.getElementById('resetStorage').addEventListener('click', () => {
            if (!confirm("Reset ALL stored data and restore default admin?")) return;

            localStorage.clear();

            // recreate admin
            localStorage.setItem(usersKey, JSON.stringify([{
                email: 'admin@rentpro',
                password: 'password123',
                name: 'Administrator'
            }]));

            alert("Data cleared. Reloading...");
            location.reload();
        });
    }

    // -------------------------------
    // PROTECT OTHER PAGES
    // -------------------------------

    // IMPORTANT — must match EXACT filenames in your root folder
    const protectedPages = [
        "dashboard.html",
        "tenants.html",
        "tenant-profile.html",  // FIXED NAME
        "payments.html",
        "expenses.html",
        "reports.html"          // FIXED NAME
    ];

    const currentPage = window.location.pathname.split("/").pop();

    if (protectedPages.includes(currentPage)) {

        const currentUser = sessionStorage.getItem("rms_currentUser");

        if (!currentUser) {
            window.location = "index.html";
        } else {
            // Enable logout button if present
            document.querySelectorAll("#logoutBtn").forEach(btn => {
                btn.addEventListener("click", () => {
                    sessionStorage.removeItem("rms_currentUser");
                    window.location = "index.html";
                });
            });
        }
    }

})();
