// Draws the shared navigation: a sidebar on laptops, a top bar plus bottom tab bar on phones.
// Include right after <body data-page="..."> so #logoutBtn exists before the page's auth script binds it.
(function () {
    const page = document.body.dataset.page || location.pathname.split('/').pop().replace('.html', '') || 'dashboard';

    const NAV = [
        { section: 'Overview' },
        { id: 'dashboard', label: 'Dashboard', icon: 'fa-chart-pie', href: 'dashboard.html' },
        { id: 'reports', label: 'Reports', icon: 'fa-chart-column', href: 'reports.html' },
        { id: 'assistant', label: 'AI Assistant', icon: 'fa-wand-magic-sparkles', href: 'assistant.html' },
        { section: 'Property' },
        { id: 'tenants', label: 'Tenants', icon: 'fa-users', href: 'tenants.html' },
        { id: 'payments', label: 'Payments', icon: 'fa-money-bill-wave', href: 'payments.html' },
        { id: 'reconcile', label: 'Unmatched', icon: 'fa-triangle-exclamation', href: 'reconcile.html', badge: true },
        { id: 'utilities', label: 'Utilities', icon: 'fa-faucet-drip', href: 'utilities.html' },
        { id: 'expenses', label: 'Expenses', icon: 'fa-receipt', href: 'expenses.html' },
        { id: 'archives', label: 'Archives', icon: 'fa-box-archive', href: 'archives.html' },
        { section: 'Tools' },
        { id: 'pay', label: 'Payment Lookup', icon: 'fa-magnifying-glass-dollar', href: 'pay.html' }
    ];
    const TABS = ['dashboard', 'tenants', 'payments', 'expenses'];
    const MORE = ['assistant', 'utilities', 'reports', 'reconcile', 'archives', 'pay'];
    // Detail pages highlight their parent and show a back arrow on phones.
    const PARENT = { 'tenant-profile': 'tenants', moveout: 'tenants', reconcile: 'payments', archives: 'tenants' };
    const TITLES = { 'tenant-profile': 'Tenant', moveout: 'Move Out', reconcile: 'Unmatched', archives: 'Archives', pay: 'Payment Lookup' };

    const item = (id) => NAV.find((n) => n.id === id);
    const active = (id) => id === page || (!item(page) && PARENT[page] === id);
    const tabActive = (id) => id === page || PARENT[page] === id;
    const title = TITLES[page] || (item(page) ? item(page).label : '');

    const sidebarLinks = NAV.map((n) => n.section
        ? `<div class="rp-nav-label">${n.section}</div>`
        : `<a href="${n.href}" class="${active(n.id) ? 'active' : ''}"><i class="fa-solid ${n.icon}"></i><span>${n.label}</span>${n.badge ? '<span class="rp-nav-badge d-none" data-unmatched-count></span>' : ''}</a>`
    ).join('');

    const tabs = TABS.map((id) => {
        const n = item(id);
        return `<a href="${n.href}" class="${tabActive(id) ? 'active' : ''}"><i class="fa-solid ${n.icon}"></i>${id === 'dashboard' ? 'Home' : n.label}</a>`;
    }).join('');
    const moreActive = MORE.some((id) => id === page) && !TABS.some(tabActive);

    const sheetLinks = MORE.map((id) => {
        const n = item(id);
        return `<a href="${n.href}" class="${id === page ? 'active' : ''}"><i class="fa-solid ${n.icon}"></i>${n.label}</a>`;
    }).join('');

    const back = PARENT[page] ? `<a class="rp-topbar-back" href="${item(PARENT[page]).href}" aria-label="Back"><i class="fa-solid fa-arrow-left"></i></a>` : '';

    document.body.insertAdjacentHTML('afterbegin', `
      <aside class="rp-sidebar" aria-label="Main navigation">
        <a href="dashboard.html" class="rp-brand"><span class="rp-brand-mark"><i class="fa-solid fa-building"></i></span>RentPro</a>
        <nav class="rp-nav">${sidebarLinks}</nav>
        <div class="rp-sidebar-foot">
          <div class="rp-user"><div class="rp-user-avatar" data-user-initial>L</div><div><span data-user-name>Landlord</span><small data-user-email>Signed in</small></div></div>
          <a href="#" id="logoutBtn" class="rp-logout"><i class="fa-solid fa-right-from-bracket"></i> Log out</a>
        </div>
      </aside>
      <header class="rp-topbar">
        ${back}
        <a href="dashboard.html" class="rp-brand"><span class="rp-brand-mark"><i class="fa-solid fa-building"></i></span>RentPro</a>
        <span class="rp-topbar-title">${title}</span>
      </header>
      <nav class="rp-tabbar" aria-label="Quick navigation">
        ${tabs}
        <button type="button" class="${moreActive ? 'active' : ''}" data-sheet-open><i class="fa-solid fa-grip"></i>More<span class="rp-tab-dot d-none" data-unmatched-dot></span></button>
      </nav>
      <div class="rp-sheet-backdrop" data-sheet-close></div>
      <div class="rp-sheet" role="dialog" aria-label="More pages">
        <div class="rp-sheet-grip"></div>
        <div class="rp-sheet-grid">
          ${sheetLinks}
          <button type="button" class="is-danger" data-logout><i class="fa-solid fa-right-from-bracket"></i>Log out</button>
        </div>
      </div>`);

    const sheet = document.querySelector('.rp-sheet');
    const openSheet = () => { document.body.classList.add('rp-sheet-open'); requestAnimationFrame(() => sheet.classList.add('open')); };
    const closeSheet = () => { sheet.classList.remove('open'); setTimeout(() => document.body.classList.remove('rp-sheet-open'), 250); };
    document.querySelector('[data-sheet-open]').addEventListener('click', openSheet);
    document.querySelector('[data-sheet-close]').addEventListener('click', closeSheet);
    document.querySelector('[data-logout]').addEventListener('click', () => { closeSheet(); document.getElementById('logoutBtn').click(); });

    // Show who is signed in (dev-auth.js announces the user once auth resolves).
    window.addEventListener('rentpro:user', (event) => {
        const user = event.detail || {};
        const name = user.displayName || (user.email ? user.email.split('@')[0] : 'Landlord');
        document.querySelector('[data-user-name]').textContent = name.charAt(0).toUpperCase() + name.slice(1);
        document.querySelector('[data-user-email]').textContent = user.email || 'Signed in';
        document.querySelector('[data-user-initial]').textContent = name.charAt(0).toUpperCase();
    });

    // Unmatched-payment counter, cached briefly so page changes don't each hit the API.
    function showUnmatched(count) {
        document.querySelectorAll('[data-unmatched-count]').forEach((el) => { el.textContent = count; el.classList.toggle('d-none', !count); });
        document.querySelectorAll('[data-unmatched-dot]').forEach((el) => el.classList.toggle('d-none', !count));
    }
    window.RentProShell = { showUnmatched };

    // "Ask AI" button and page-specific panel (needs global.js, so it loads once the page is parsed).
    window.addEventListener('DOMContentLoaded', () => {
        const script = document.createElement('script');
        script.src = 'js/ai-panel.js';
        document.body.appendChild(script);
    });

    // Android app: the phone's Back button closes the menu, then goes back a page, then leaves the app.
    const appPlugin = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
    if (appPlugin) {
        appPlugin.addListener('backButton', ({ canGoBack }) => {
            if (window.RentProAIPanel && window.RentProAIPanel.isOpen()) return window.RentProAIPanel.close();
            if (document.body.classList.contains('rp-sheet-open')) return closeSheet();
            const modal = document.querySelector('.modal.show');
            if (modal && window.bootstrap) return bootstrap.Modal.getInstance(modal)?.hide();
            if (canGoBack && page !== 'dashboard') return history.back();
            appPlugin.exitApp();
        });
    }
    window.addEventListener('DOMContentLoaded', async () => {
        try {
            const cached = JSON.parse(sessionStorage.getItem('rentpro_unmatched') || 'null');
            if (cached && Date.now() - cached.at < 120000) return showUnmatched(cached.count);
            if (typeof apiRequest !== 'function') return;
            const result = await apiRequest({ action: 'getUnmatched' });
            const count = (result.data || []).length;
            sessionStorage.setItem('rentpro_unmatched', JSON.stringify({ at: Date.now(), count }));
            showUnmatched(count);
        } catch (error) { /* the badge is optional */ }
    });
})();
