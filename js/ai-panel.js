// "Ask AI" on every page: a floating button that opens a panel with quick actions tailored to the page.
// Loaded by js/shell.js. Questions go to the aiAssist action with the page name (and tenant on a profile),
// so the assistant focuses on what that page is for. Pages can add their own actions that do work on the page
// by listening for the "rentpro:ai-action" event (see reconcile.html and expenses.html).
(function () {
    const page = document.body.dataset.page || 'dashboard';
    if (page === 'assistant') return; // the full assistant page is already a chat

    const tenantId = page === 'tenant-profile' ? new URLSearchParams(location.search).get('id') || '' : '';
    const STORE = 'rentpro_ai_panel_' + page + (tenantId ? '_' + tenantId : '');

    // Quick actions per page. "prompt" asks the assistant; "run" asks the page itself to do something.
    const ACTIONS = {
        dashboard: { title: 'Dashboard', items: [
            ['fa-sun', "Today's briefing", "Give me a short briefing on this month's rent collection and what needs my attention."],
            ['fa-user-clock', 'Who should I follow up with?', 'Which tenants should I follow up with this week, and why?'],
            ['fa-scale-balanced', 'This month vs last month', 'Compare this month with last month: rent collected, payments and expenses.']] },
        tenants: { title: 'Tenants', items: [
            ['fa-circle-exclamation', 'Who is behind on rent?', 'Which tenants are behind on rent, and by how much? Sort from highest balance.'],
            ['fa-comment-sms', 'Reminders for everyone owing', 'Draft a short, polite SMS reminder for each tenant who has a balance, including their balance and the paybill details.'],
            ['fa-id-card', 'Missing tenant details', 'Which tenants are missing next-of-kin details?']] },
        'tenant-profile': { title: 'this tenant', items: [
            ['fa-user', 'Summarise this tenant', 'Summarise this tenant: balance, how regularly they pay, utilities and anything I should watch.'],
            ['fa-clock', 'Do they pay on time?', 'Looking at their payment history, does this tenant usually pay on time and in full?'],
            ['fa-comment-sms', 'Reminder (English)', 'Draft a short, polite SMS rent reminder for this tenant in English, with their balance and the paybill details.'],
            ['fa-language', 'Reminder (Kiswahili)', 'Draft a short, polite SMS rent reminder for this tenant in Kiswahili, with their balance and the paybill details.']] },
        payments: { title: 'Payments', items: [
            ['fa-sack-dollar', "This month's payments", 'Summarise the payments received this month: total, number of payments and who paid.'],
            ['fa-magnifying-glass-dollar', 'Unusual or duplicate payments', 'Are there any unusual, very large, very small or possibly duplicate payments I should check?'],
            ['fa-triangle-exclamation', 'Unmatched payments', 'Who might the unmatched payments belong to? Explain your reasoning briefly.']] },
        reconcile: { title: 'Unmatched payments', items: [
            ['fa-wand-magic-sparkles', 'Suggest a tenant for each payment', null, 'suggest-matches'],
            ['fa-circle-question', 'How should I match these?', 'Explain how I should decide which tenant each unmatched payment belongs to.']] },
        utilities: { title: 'Utilities', items: [
            ['fa-faucet-drip', "Who hasn't paid utilities?", 'Which houses have unpaid water or garbage bills, and how much does each owe?'],
            ['fa-chart-line', 'Highest water use', 'Which houses use the most water, and is anyone unusually high?'],
            ['fa-calculator', 'Total owed', 'How much is owed in utilities in total, split into water and garbage?']] },
        expenses: { title: 'Expenses', items: [
            ['fa-chart-pie', 'Spending by category', 'Summarise my expenses by category and by house.'],
            ['fa-magnifying-glass', 'Unusual spending', 'Is there any unusual or repeated spending I should look into?'],
            ['fa-piggy-bank', 'Where can I save?', 'Based on my expenses, where could I realistically save money?']] },
        reports: { title: 'Reports', items: [
            ['fa-lightbulb', 'Explain my numbers', 'Explain my income, expenses and profit in simple terms.'],
            ['fa-percent', 'Collection rate', "What is my rent collection rate, and how has it changed recently?"],
            ['fa-list-check', 'What to improve', 'What are the three most useful things I can do next month to improve my income?']] },
        archives: { title: 'Former tenants', items: [
            ['fa-file-invoice-dollar', 'Unpaid balances', 'Which former tenants left unpaid balances, and how much in total?'],
            ['fa-door-open', 'Why tenants leave', 'Looking at move-out reasons, are there patterns I should address?']] },
        pay: { title: 'Payment lookup', items: [
            ['fa-message', 'Payment instructions message', 'Write a short message I can send any tenant explaining how to pay rent with the paybill and their house account number.']] },
        moveout: { title: 'Move-out', items: [
            ['fa-list-check', 'Move-out checklist', 'Give me a practical checklist for moving a tenant out, including the final balance and deposit.'],
            ['fa-money-bill-transfer', 'Deposit refund message', 'Draft a polite message to a tenant explaining their deposit refund and any deductions.'],
            ['fa-hand', 'Goodbye message', 'Draft a short, friendly goodbye message to a tenant who is moving out.']] }
    };
    const config = ACTIONS[page] || { title: 'this page', items: [] };

    document.body.insertAdjacentHTML('beforeend', `
      <button type="button" class="ai-fab" id="aiFab" aria-label="Ask AI about ${config.title}">
        <i class="fa-solid fa-wand-magic-sparkles"></i><span>Ask AI</span>
      </button>
      <div class="ai-panel-backdrop" id="aiBackdrop"></div>
      <aside class="ai-panel" id="aiPanel" role="dialog" aria-modal="true" aria-label="AI assistant for ${config.title}">
        <header class="ai-panel-head">
          <div class="ai-card-icon"><i class="fa-solid fa-wand-magic-sparkles"></i></div>
          <div class="min-w-0 flex-grow-1">
            <div class="fw-bold text-dark">AI for ${config.title}</div>
            <div class="small text-muted">Uses your live RentPro data</div>
          </div>
          <button type="button" class="ai-icon-btn" id="aiClear" title="New conversation" aria-label="New conversation"><i class="fa-solid fa-rotate-left"></i></button>
          <button type="button" class="ai-icon-btn" id="aiClose" title="Close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
        </header>
        <div class="ai-panel-log" id="aiLog" aria-live="polite"></div>
        <footer class="ai-panel-foot">
          <form class="ai-panel-form" id="aiForm">
            <textarea id="aiInput" rows="1" maxlength="2000" placeholder="Ask about ${config.title}…" aria-label="Your question"></textarea>
            <button type="submit" class="btn btn-primary" id="aiSend" aria-label="Send"><i class="fa-solid fa-arrow-up"></i></button>
          </form>
          <div class="d-flex justify-content-between small mt-2">
            <span class="text-muted">AI can make mistakes. Check key figures.</span>
            <a href="assistant.html" class="text-decoration-none">Full assistant <i class="fa-solid fa-arrow-right"></i></a>
          </div>
        </footer>
      </aside>`);

    const fab = document.getElementById('aiFab');
    const panel = document.getElementById('aiPanel');
    const backdrop = document.getElementById('aiBackdrop');
    const log = document.getElementById('aiLog');
    const input = document.getElementById('aiInput');
    const send = document.getElementById('aiSend');
    let history = [];
    try { history = JSON.parse(sessionStorage.getItem(STORE) || '[]'); } catch (error) { history = []; }
    let busy = false;

    const save = () => { try { sessionStorage.setItem(STORE, JSON.stringify(history.slice(-12))); } catch (error) { /* optional */ } };

    function open() {
        document.body.classList.add('ai-panel-open');
        requestAnimationFrame(() => panel.classList.add('open'));
        setTimeout(() => input.focus(), 250);
    }
    function close() {
        panel.classList.remove('open');
        setTimeout(() => document.body.classList.remove('ai-panel-open'), 250);
    }

    function renderStart() {
        log.innerHTML = `
          <div class="ai-panel-intro">
            <p class="mb-2">Hi! I can help with <strong>${escapeHtml(config.title)}</strong>. Try one of these, or ask your own question.</p>
            <div class="ai-actions">${config.items.map(([icon, label, prompt, run], i) =>
                `<button type="button" class="ai-action" data-index="${i}"><i class="fa-solid ${icon}"></i><span>${escapeHtml(label)}</span>${run ? '<span class="ai-action-tag">Does it for you</span>' : ''}</button>`).join('')}</div>
          </div>`;
    }

    function addMessage(role, text, options = {}) {
        log.querySelector('.ai-panel-intro')?.remove();
        const el = document.createElement('div');
        el.className = `ai-msg ${role === 'user' ? 'user' : 'ai'}${options.error ? ' error' : ''}`;
        el.innerHTML = role === 'user'
            ? `<div class="ai-bubble">${escapeHtml(text)}</div>`
            : `<div class="ai-bubble">${options.error ? escapeHtml(text) : renderAiText(text)}</div>${options.error ? '' : '<button type="button" class="ai-copy"><i class="fa-regular fa-copy me-1"></i>Copy</button>'}`;
        const copy = el.querySelector('.ai-copy');
        if (copy) copy.addEventListener('click', async () => {
            try { await navigator.clipboard.writeText(text); copy.innerHTML = '<i class="fa-solid fa-check me-1"></i>Copied'; }
            catch (error) { copy.innerText = 'Copy failed'; }
            setTimeout(() => { copy.innerHTML = '<i class="fa-regular fa-copy me-1"></i>Copy'; }, 1500);
        });
        log.appendChild(el);
        log.scrollTop = log.scrollHeight;
    }

    function typing() {
        const el = document.createElement('div');
        el.className = 'ai-msg ai';
        el.innerHTML = '<div class="ai-bubble"><span class="ai-typing"><span></span><span></span><span></span></span></div>';
        log.appendChild(el);
        log.scrollTop = log.scrollHeight;
        return el;
    }

    async function ask(question) {
        question = String(question || '').trim();
        if (!question || busy) return;
        busy = true;
        send.disabled = true;
        input.value = '';
        input.style.height = 'auto';
        addMessage('user', question);
        const wait = typing();
        const recent = history.slice(-4).map(turn => ({ role: turn.role, content: turn.content.slice(0, 600) }));
        try {
            const result = await aiRequest({ action: 'aiAssist', mode: 'ask', page, tenantId, question, history: recent });
            wait.remove();
            const text = ((result.data && result.data.text) || 'No answer came back. Please try again.') +
                (result.data && result.data.notice ? '\n\n_' + result.data.notice + '_' : '');
            addMessage('assistant', text);
            history.push({ role: 'user', content: question }, { role: 'assistant', content: text });
            save();
        } catch (error) {
            wait.remove();
            addMessage('assistant', error.message || 'Something went wrong. Please try again.', { error: true });
        } finally {
            busy = false;
            send.disabled = false;
        }
    }

    log.addEventListener('click', (event) => {
        const button = event.target.closest('.ai-action');
        if (!button) return;
        const [, label, prompt, run] = config.items[Number(button.dataset.index)];
        if (run) {
            // The page does the work (e.g. pre-fill assignments); the panel closes so the result is visible.
            window.dispatchEvent(new CustomEvent('rentpro:ai-action', { detail: { name: run } }));
            close();
        } else {
            ask(prompt || label);
        }
    });
    fab.addEventListener('click', open);
    backdrop.addEventListener('click', close);
    document.getElementById('aiClose').addEventListener('click', close);
    document.getElementById('aiClear').addEventListener('click', () => { history = []; save(); renderStart(); input.focus(); });
    document.getElementById('aiForm').addEventListener('submit', (event) => { event.preventDefault(); ask(input.value); });
    input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = Math.min(input.scrollHeight, 120) + 'px'; });
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); ask(input.value); } });
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape' && panel.classList.contains('open')) close(); });

    if (history.length) history.forEach(turn => addMessage(turn.role, turn.content));
    else renderStart();

    window.RentProAIPanel = { open, close, ask, isOpen: () => panel.classList.contains('open') };
})();
