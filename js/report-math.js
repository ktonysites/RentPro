// Report calculations for reports.html, kept free of the page so they can be unit-tested in Node.
// All periods are whole calendar months. Rent is expected for every month a tenant (current or former)
// occupied a house: from the month they were added to the month they moved out (or now).
(function (root) {
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const num = (v) => Number(v) || 0;
    const monthIndex = (date) => date.getFullYear() * 12 + date.getMonth();
    const fromIndex = (i) => new Date(Math.floor(i / 12), i % 12, 1);
    const toDate = (value) => {
        if (value instanceof Date) return value;
        if (value === '' || value === null || value === undefined) return null;
        const d = new Date(value);
        return isNaN(d) ? null : d;
    };

    // "Oct 2026" (utility bill months) -> Date of the 1st.
    function parseMonthLabel(label) {
        const m = String(label || '').match(/^([A-Za-z]{3})[a-z]*\s+(\d{4})$/);
        if (!m) return null;
        const i = MONTHS.findIndex(x => x.toLowerCase() === m[1].toLowerCase());
        return i < 0 ? null : new Date(Number(m[2]), i, 1);
    }

    // range: this_month | last_month | last_3_months | this_year | last_year | all_time | custom
    // custom uses { from: "YYYY-MM", to: "YYYY-MM" }; all_time needs earliestDate.
    function periodFor(range, now, options = {}) {
        const current = monthIndex(now);
        let first, last;
        if (range === 'last_month') { first = last = current - 1; }
        else if (range === 'last_3_months') { first = current - 2; last = current; }
        else if (range === 'this_year') { first = now.getFullYear() * 12; last = current; }
        else if (range === 'last_year') { first = (now.getFullYear() - 1) * 12; last = first + 11; }
        else if (range === 'all_time') {
            const earliest = toDate(options.earliestDate) || now;
            first = Math.min(monthIndex(earliest), current); last = current;
        } else if (range === 'custom' && options.from && options.to) {
            const [fy, fm] = options.from.split('-').map(Number);
            const [ty, tm] = options.to.split('-').map(Number);
            first = fy * 12 + fm - 1; last = ty * 12 + tm - 1;
            if (first > last) [first, last] = [last, first];
        } else { first = last = current; }
        return buildPeriod(first, last);
    }

    function buildPeriod(first, last) {
        const months = [];
        for (let i = first; i <= last; i++) months.push(i);
        const start = fromIndex(first);
        const end = new Date(fromIndex(last + 1).getTime() - 1);
        const fmt = (i) => `${MONTHS[i % 12]} ${Math.floor(i / 12)}`;
        return { first, last, months, start, end, label: first === last ? fmt(first) : `${fmt(first)} – ${fmt(last)}` };
    }

    // The same number of months immediately before, for "vs previous period".
    function previousPeriod(period) {
        const length = period.last - period.first + 1;
        return buildPeriod(period.first - length, period.first - 1);
    }

    const inPeriod = (value, period) => {
        const d = toDate(value);
        return !!d && d >= period.start && d <= period.end;
    };

    // Months (indexes) a tenancy covers within the period.
    function occupiedMonths(tenancy, period, now) {
        const startDate = toDate(tenancy.DateAdded) || period.start;
        const endDate = toDate(tenancy.ArchivedDate) || now;
        const from = Math.max(period.first, monthIndex(startDate));
        const to = Math.min(period.last, monthIndex(endDate), monthIndex(now));
        const out = [];
        for (let i = from; i <= to; i++) out.push(i);
        return out;
    }

    // Main report. data = { tenants, former, payments, expenses, utilities }.
    function buildReport(data, period, now) {
        const tenancies = (data.tenants || []).map(t => ({ ...t, former: false }))
            .concat((data.former || []).map(t => ({ ...t, former: true })));
        const payments = (data.payments || []).filter(p => inPeriod(p.Date, period));
        const expenses = (data.expenses || []).filter(e => inPeriod(e.Date, period));
        const utilities = (data.utilities || []).filter(u => {
            const d = parseMonthLabel(u.Month);
            return d && monthIndex(d) >= period.first && monthIndex(d) <= period.last;
        });

        // Month-by-month series.
        const monthly = period.months.map(i => ({ index: i, label: `${MONTHS[i % 12]} ${String(Math.floor(i / 12)).slice(2)}`, expected: 0, collected: 0, expenses: 0 }));
        const byIndex = {};
        monthly.forEach(m => { byIndex[m.index] = m; });
        tenancies.forEach(t => occupiedMonths(t, period, now).forEach(i => { if (byIndex[i]) byIndex[i].expected += num(t.Rent); }));
        payments.forEach(p => { const m = byIndex[monthIndex(toDate(p.Date))]; if (m) m.collected += num(p.Amount); });
        expenses.forEach(e => { const m = byIndex[monthIndex(toDate(e.Date))]; if (m) m.expenses += num(e.Amount); });
        monthly.forEach(m => { m.net = m.collected - m.expenses; m.rate = m.expected ? m.collected / m.expected : null; });

        const expected = monthly.reduce((s, m) => s + m.expected, 0);
        const collected = monthly.reduce((s, m) => s + m.collected, 0);
        const spent = monthly.reduce((s, m) => s + m.expenses, 0);

        // Per house: current tenant, expected and collected rent, expenses, current balance.
        const houses = {};
        const house = (key) => {
            const k = String(key || '').trim() || '—';
            return houses[k] = houses[k] || { house: k, tenant: '', expected: 0, collected: 0, expenses: 0, balance: 0 };
        };
        tenancies.forEach(t => {
            const months = occupiedMonths(t, period, now).length;
            if (!months && t.former) return;
            const h = house(t.House);
            h.expected += months * num(t.Rent);
            if (!t.former) { h.tenant = t.Name; h.balance = num(t.Rent) - num(t.AmountPaid); }
            else if (!h.tenant) h.tenant = t.Name + ' (moved out)';
        });
        payments.forEach(p => { if (String(p.House || '').trim()) house(p.House).collected += num(p.Amount); });
        expenses.forEach(e => { const k = String(e.House || '').trim(); if (k && k.toLowerCase() !== 'general') house(k).expenses += num(e.Amount); });
        const houseRows = Object.values(houses).map(h => ({ ...h, net: h.collected - h.expenses }))
            .sort((a, b) => a.house.localeCompare(b.house, undefined, { numeric: true }));

        // Expenses by category.
        const categories = {};
        expenses.forEach(e => { const c = e.Category || 'Other'; categories[c] = (categories[c] || 0) + num(e.Amount); });

        const unmatched = payments.filter(p => /unmatched|unassigned/i.test(String(p.Notes || '')));
        const arrears = (data.tenants || []).map(t => ({ name: t.Name, house: t.House, balance: num(t.Rent) - num(t.AmountPaid) }))
            .filter(t => t.balance > 0).sort((a, b) => b.balance - a.balance);

        return {
            period,
            expected, collected, expenses: spent,
            net: collected - spent,
            collectionRate: expected ? collected / expected : null,
            margin: collected ? (collected - spent) / collected : null,
            outstanding: Math.max(0, expected - collected),
            paymentsCount: payments.length,
            averagePayment: payments.length ? collected / payments.length : 0,
            unmatched: { count: unmatched.length, amount: unmatched.reduce((s, p) => s + num(p.Amount), 0) },
            currentArrears: { total: arrears.reduce((s, t) => s + t.balance, 0), top: arrears.slice(0, 8), count: arrears.length },
            utilities: {
                billed: utilities.reduce((s, u) => s + num(u.Water) + num(u.Garbage), 0),
                paid: utilities.filter(u => u.Status === 'Paid').reduce((s, u) => s + num(u.Water) + num(u.Garbage), 0),
                unpaidCount: utilities.filter(u => u.Status !== 'Paid').length
            },
            monthly,
            houses: houseRows,
            categories: Object.entries(categories).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
            payments, expensesList: expenses
        };
    }

    // Change between two values as a fraction (null when there's nothing to compare).
    const change = (now, before) => (before ? (now - before) / Math.abs(before) : null);

    // Earliest date in the data, for "All time".
    function earliestDate(data) {
        const dates = [].concat(
            (data.payments || []).map(p => toDate(p.Date)),
            (data.expenses || []).map(e => toDate(e.Date)),
            (data.tenants || []).map(t => toDate(t.DateAdded)),
            (data.former || []).map(t => toDate(t.DateAdded))
        ).filter(Boolean);
        return dates.length ? new Date(Math.min.apply(null, dates)) : null;
    }

    const api = { periodFor, previousPeriod, buildReport, change, earliestDate, parseMonthLabel };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.RentProReport = api;
})(typeof window !== 'undefined' ? window : globalThis);
