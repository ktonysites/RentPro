// RentPro loading screen. Include as the first thing inside <body>.
// First page of a visit: full-screen splash (building whose windows light up) until sign-in is checked.
// Later pages in the same visit: a slim progress line at the top instead, so navigation stays quick.
// It hides when js/dev-auth.js reports the sign-in result, or after a few seconds at most.
(function () {
    const SEEN_KEY = 'rentpro_splash_seen';
    const MIN_FULL_MS = 2000;   // long enough for the window animation to read, short enough not to annoy
    const MAX_WAIT_MS = 7000;   // never block the page if Firebase or the network is slow

    let firstVisit = true;
    try { firstVisit = !sessionStorage.getItem(SEEN_KEY); } catch (error) { /* storage blocked: show the full splash */ }

    const path = location.pathname.split('/').pop();
    const onLoginPage = path === '' || path === 'index.html';

    const style = document.createElement('style');
    style.textContent = `
      .rp-splash { position: fixed; inset: 0; z-index: 3000; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 22px;
        background: radial-gradient(60% 45% at 50% 42%, rgba(99, 102, 241, 0.22), transparent 70%), #0c1022; color: #fff;
        font-family: 'Inter', system-ui, -apple-system, 'Segoe UI', sans-serif; transition: opacity 0.45s ease, visibility 0.45s ease; }
      .rp-splash.is-leaving { opacity: 0; visibility: hidden; }
      .rp-splash.is-leaving .rp-splash-mark { transform: scale(1.08); }
      .rp-splash-mark { position: relative; width: 112px; height: 112px; transition: transform 0.45s ease; animation: rpFloat 3.2s ease-in-out infinite; }
      .rp-splash-mark svg { width: 100%; height: 100%; filter: drop-shadow(0 18px 40px rgba(79, 70, 229, 0.55)); }
      .rp-splash-ring { position: absolute; inset: -14px; border-radius: 36px; border: 2px solid rgba(129, 140, 248, 0.45); animation: rpRing 2.2s ease-out infinite; }
      .rp-splash-ring.r2 { animation-delay: 1.1s; }
      .rp-splash-name { font-size: 1.9rem; font-weight: 800; letter-spacing: -0.03em; }
      .rp-splash-tag { margin-top: -14px; font-size: 0.9rem; color: #a3abc4; }
      .rp-splash-bar { width: 168px; height: 4px; border-radius: 4px; background: rgba(255, 255, 255, 0.1); overflow: hidden; }
      .rp-splash-bar::after { content: ""; display: block; width: 40%; height: 100%; border-radius: 4px;
        background: linear-gradient(90deg, #6366f1, #a78bfa); animation: rpSlide 1.15s ease-in-out infinite; }
      .rp-splash .win { fill: #4f46e5; animation: rpLight 2.4s ease-in-out infinite; }
      .rp-splash .win.w2 { animation-delay: 0.2s; } .rp-splash .win.w3 { animation-delay: 0.4s; }
      .rp-splash .win.w4 { animation-delay: 0.6s; } .rp-splash .win.w5 { animation-delay: 0.8s; } .rp-splash .win.w6 { animation-delay: 1s; }
      .rp-splash .door { fill: #4f46e5; }

      .rp-topload { position: fixed; top: 0; left: 0; right: 0; height: 3px; z-index: 3000; overflow: hidden; pointer-events: none; transition: opacity 0.3s ease; }
      .rp-topload::after { content: ""; position: absolute; top: 0; bottom: 0; width: 35%;
        background: linear-gradient(90deg, transparent, #818cf8, #a78bfa, transparent); animation: rpTop 1s ease-in-out infinite; }
      .rp-topload.is-leaving { opacity: 0; }

      @keyframes rpFloat { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-8px); } }
      @keyframes rpRing { 0% { transform: scale(0.85); opacity: 0.9; } 100% { transform: scale(1.35); opacity: 0; } }
      @keyframes rpSlide { 0% { transform: translateX(-110%); } 100% { transform: translateX(260%); } }
      @keyframes rpTop { 0% { left: -35%; } 100% { left: 100%; } }
      @keyframes rpLight { 0%, 18% { fill: #4f46e5; } 35%, 70% { fill: #fbbf24; } 88%, 100% { fill: #4f46e5; } }
      @media (prefers-reduced-motion: reduce) {
        .rp-splash *, .rp-splash *::after, .rp-topload::after { animation: none !important; }
        .rp-splash .win { fill: #fbbf24; }
      }`;
    document.head.appendChild(style);

    const el = document.createElement('div');
    if (firstVisit) {
        el.className = 'rp-splash';
        el.setAttribute('role', 'status');
        el.setAttribute('aria-label', 'Loading RentPro');
        el.innerHTML = `
          <div class="rp-splash-mark">
            <span class="rp-splash-ring"></span><span class="rp-splash-ring r2"></span>
            <svg viewBox="0 0 100 100" aria-hidden="true">
              <defs><linearGradient id="rpSplashTile" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stop-color="#6366f1"/><stop offset="0.55" stop-color="#4f46e5"/><stop offset="1" stop-color="#7c3aed"/>
              </linearGradient></defs>
              <rect width="100" height="100" rx="22" fill="url(#rpSplashTile)"/>
              <rect x="30" y="24" width="40" height="54" rx="3.5" fill="#fff"/>
              <rect class="win" x="37.5" y="33" width="7.5" height="7" rx="1.2"/>
              <rect class="win w2" x="54.5" y="33" width="7.5" height="7" rx="1.2"/>
              <rect class="win w3" x="37.5" y="45" width="7.5" height="7" rx="1.2"/>
              <rect class="win w4" x="54.5" y="45" width="7.5" height="7" rx="1.2"/>
              <rect class="win w5" x="37.5" y="57" width="7.5" height="7" rx="1.2"/>
              <rect class="win w6" x="54.5" y="57" width="7.5" height="7" rx="1.2"/>
              <rect class="door" x="45.5" y="67" width="9" height="11" rx="1.2"/>
              <rect x="22" y="77.5" width="56" height="3" rx="1.5" fill="#fff"/>
            </svg>
          </div>
          <div class="rp-splash-name">RentPro</div>
          <div class="rp-splash-tag">Property management, simplified</div>
          <div class="rp-splash-bar"></div>`;
    } else {
        el.className = 'rp-topload';
    }
    document.body.prepend(el);

    const started = performance.now();
    let finished = false;
    function finish() {
        if (finished) return;
        finished = true;
        const wait = firstVisit ? Math.max(0, MIN_FULL_MS - (performance.now() - started)) : 0;
        setTimeout(() => {
            el.classList.add('is-leaving');
            setTimeout(() => el.remove(), 500);
            try { sessionStorage.setItem(SEEN_KEY, '1'); } catch (error) { /* optional */ }
        }, wait);
    }

    // Stay up while a redirect is about to happen (signed-in user on the login page, or signed-out
    // user on an inner page) so the wrong page never flashes; hide once this page is the right one.
    window.addEventListener('rentpro:auth', (event) => {
        const signedIn = !!event.detail;
        if (signedIn !== onLoginPage) finish();
    });
    setTimeout(finish, MAX_WAIT_MS);

    window.RentProSplash = { hide: finish };
})();
