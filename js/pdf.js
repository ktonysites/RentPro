// PDFs and file downloads for every page, in the browser and in the Android app.
//  - RentProFiles.save(data, filename, mime): downloads in a browser; in the app it saves the file and opens
//    Android's share sheet (WhatsApp, Gmail, Drive, Files…), because the app's web view can't download or print.
//  - RentProPDF.create({ title, subtitle, orientation }): a branded A4 document with helpers for headings,
//    detail grids, summary tiles and tables (jsPDF + AutoTable, bundled in js/vendor so they work offline).
(function () {
    const BRAND = [79, 70, 229];      // indigo, as in the app
    const INK = [17, 24, 39];
    const MUTED = [107, 114, 128];
    const LINE = [229, 231, 235];
    const SOFT = [243, 244, 246];
    const RED = [220, 38, 38];
    const GREEN = [22, 163, 74];

    // The property on every document.
    const PROPERTY = {
        name: 'Nancy Wanjiru Ngari Rentals',
        payment: 'Pay rent via Equity Paybill 247247, Account 275515#<house>'
    };

    const isApp = () => !!(window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform());
    const plugin = (name) => (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins[name]) || null;

    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1]);
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(blob);
        });
    }

    const RentProFiles = {
        async save(data, filename, mime) {
            const blob = data instanceof Blob ? data : new Blob([data], { type: mime || 'text/plain' });
            const safeName = String(filename).replace(/[\\/:*?"<>|]+/g, '_');
            const Filesystem = plugin('Filesystem');
            const Share = plugin('Share');
            if (isApp() && Filesystem) {
                const written = await Filesystem.writeFile({ path: safeName, data: await blobToBase64(blob), directory: 'CACHE', recursive: true });
                if (Share) {
                    try {
                        await Share.share({ title: safeName, files: [written.uri], dialogTitle: 'Save or send ' + safeName });
                    } catch (error) {
                        // Closing the share sheet, or a second tap while it is still open, is not an error: the file is saved.
                        if (!/cancel|in progress/i.test(String(error && error.message))) throw error;
                    }
                }
                return written.uri;
            }
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = safeName;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(url), 60000);
            return url;
        },

        // Rows of cells -> CSV text that Excel opens (with a BOM so "–" and "·" survive).
        csv(rows) {
            const quote = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
            return '﻿' + rows.map(r => r.map(quote).join(',')).join('\r\n');
        },

        saveCsv(rows, filename) {
            return this.save(new Blob([this.csv(rows)], { type: 'text/csv;charset=utf-8' }), filename, 'text/csv');
        }
    };

    const money = (n) => Math.round(Number(n) || 0).toLocaleString('en-KE');
    const kes = (n) => 'KES ' + money(n);
    const dateText = (d = new Date()) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

    function create({ title, subtitle = '', orientation = 'portrait', format = 'a4' }) {
        if (!window.jspdf || !window.jspdf.jsPDF) throw new Error('The PDF tool did not load. Check your connection and reload the page.');
        const doc = new window.jspdf.jsPDF({ orientation, unit: 'mm', format });
        const W = doc.internal.pageSize.getWidth();
        const H = doc.internal.pageSize.getHeight();
        const M = 14;
        const generated = new Date();
        let y = 0;

        // First-page header band.
        doc.setFillColor(...BRAND);
        doc.rect(0, 0, W, 28, 'F');
        doc.setTextColor(255, 255, 255);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(18);
        doc.text(title, M, 13);
        doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
        doc.text(subtitle || PROPERTY.name, M, 20.5);
        doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
        doc.text('RentPro', W - M, 13, { align: 'right' });
        doc.setFont('helvetica', 'normal'); doc.setFontSize(8.5);
        doc.text('Property management', W - M, 20.5, { align: 'right' });
        y = 36;

        const ensure = (space) => { if (y + space > H - 22) { doc.addPage(); y = 20; } };
        const table = (options) => {
            const run = window.autoTable || (window.jspdf_autotable && window.jspdf_autotable.autoTable);
            // Headings and totals line up with their column (e.g. amounts on the right).
            const own = options.didParseCell;
            const config = {
                startY: y, margin: { left: M, right: M, top: 20, bottom: 22 }, theme: 'grid',
                styles: { font: 'helvetica', fontSize: 8.5, cellPadding: 2, textColor: INK, lineColor: LINE, lineWidth: 0.2, overflow: 'linebreak' },
                headStyles: { fillColor: BRAND, textColor: 255, fontStyle: 'bold', fontSize: 8 },
                footStyles: { fillColor: SOFT, textColor: INK, fontStyle: 'bold' },
                alternateRowStyles: { fillColor: [249, 250, 251] },
                showFoot: 'lastPage',
                ...options,
                didParseCell: (data) => {
                    const column = (options.columnStyles || {})[data.column.index];
                    if (data.section !== 'body' && column && column.halign) data.cell.styles.halign = column.halign;
                    if (own) own(data);
                }
            };
            if (run) run(doc, config); else doc.autoTable(config);
            y = doc.lastAutoTable.finalY + 7;
        };

        const ctx = {
            doc, W, H, M,
            get y() { return y; }, set y(v) { y = v; },
            ensure,
            heading(text) {
                ensure(14);
                doc.setFont('helvetica', 'bold'); doc.setFontSize(11.5); doc.setTextColor(...INK);
                doc.text(text, M, y);
                doc.setDrawColor(...BRAND); doc.setLineWidth(0.6); doc.line(M, y + 1.8, M + 16, y + 1.8);
                y += 7;
            },
            paragraph(text, { color = MUTED, size = 9 } = {}) {
                doc.setFont('helvetica', 'normal'); doc.setFontSize(size); doc.setTextColor(...color);
                const lines = doc.splitTextToSize(text, W - 2 * M);
                ensure(lines.length * size * 0.42 + 2);
                doc.text(lines, M, y);
                y += lines.length * size * 0.42 + 3;
            },
            // [[label, value], …] laid out in columns.
            details(pairs, columns = 2) {
                const colW = (W - 2 * M) / columns;
                const rows = Math.ceil(pairs.length / columns);
                ensure(rows * 10 + 2);
                pairs.forEach(([label, value], i) => {
                    const x = M + (i % columns) * colW, top = y + Math.floor(i / columns) * 10;
                    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
                    doc.text(String(label).toUpperCase(), x, top);
                    doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...INK);
                    doc.text(doc.splitTextToSize(String(value ?? '–') || '–', colW - 4)[0], x, top + 4.5);
                });
                y += rows * 10 + 2;
            },
            // Summary tiles: [[label, value, 'good'|'bad'|undefined], …]
            tiles(items) {
                const gap = 3, w = (W - 2 * M - gap * (items.length - 1)) / items.length;
                ensure(20);
                items.forEach(([label, value, tone], i) => {
                    const x = M + i * (w + gap);
                    doc.setFillColor(...SOFT); doc.roundedRect(x, y, w, 16, 2, 2, 'F');
                    doc.setFont('helvetica', 'normal'); doc.setFontSize(7); doc.setTextColor(...MUTED);
                    doc.text(String(label).toUpperCase(), x + 3, y + 5.5);
                    doc.setFont('helvetica', 'bold'); doc.setFontSize(w < 40 ? 9.5 : 11);
                    doc.setTextColor(...(tone === 'good' ? GREEN : tone === 'bad' ? RED : INK));
                    doc.text(doc.splitTextToSize(String(value), w - 5)[0], x + 3, y + 12);
                });
                y += 22;
            },
            table,
            // Two-column label/amount list, e.g. a settlement. rows: [label, amount, { bold, indent, total }]
            ledger(rows, { width } = {}) {
                const w = width || W - 2 * M;
                table({
                    theme: 'plain', tableWidth: w,
                    body: rows.map(([label, amount, opt = {}]) => [
                        { content: (opt.indent ? '    ' : '') + label, styles: { fontStyle: opt.bold || opt.total ? 'bold' : 'normal', textColor: opt.indent ? MUTED : INK } },
                        { content: typeof amount === 'string' ? amount : kes(amount), styles: { halign: 'right', fontStyle: opt.bold || opt.total ? 'bold' : 'normal', fontSize: opt.total ? 10.5 : 8.5 } }
                    ]),
                    styles: { fontSize: 8.5, cellPadding: 1.8, lineColor: LINE },
                    didParseCell: (data) => { if (rows[data.row.index] && rows[data.row.index][2] && rows[data.row.index][2].total) { data.cell.styles.fillColor = SOFT; } }
                });
            },
            signatures(labels = ['Prepared by', 'Approved by']) {
                ensure(22);
                y += 6;
                const w = (W - 2 * M - 10) / labels.length;
                labels.forEach((label, i) => {
                    const x = M + i * (w + 10);
                    doc.setDrawColor(...MUTED); doc.setLineWidth(0.3);
                    doc.line(x, y + 8, x + w * 0.62, y + 8);
                    doc.line(x + w * 0.68, y + 8, x + w, y + 8);
                    doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...MUTED);
                    doc.text(label + ' (name & signature)', x, y + 12);
                    doc.text('Date', x + w * 0.68, y + 12);
                });
                y += 18;
            },
            async save(filename) {
                const pages = doc.getNumberOfPages();
                for (let i = 1; i <= pages; i++) {
                    doc.setPage(i);
                    if (i > 1) {
                        doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); doc.setTextColor(...BRAND);
                        doc.text(title, M, 11);
                        doc.setFont('helvetica', 'normal'); doc.setTextColor(...MUTED);
                        doc.text(subtitle, W - M, 11, { align: 'right' });
                        doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.line(M, 13.5, W - M, 13.5);
                    }
                    doc.setDrawColor(...LINE); doc.setLineWidth(0.3); doc.line(M, H - 16, W - M, H - 16);
                    doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...BRAND);
                    doc.text(PROPERTY.payment, M, H - 11.5);
                    doc.setFont('helvetica', 'normal'); doc.setTextColor(...MUTED);
                    doc.text(`Generated by RentPro on ${dateText(generated)} at ${generated.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`, M, H - 7);
                    doc.text(`Page ${i} of ${pages}`, W - M, H - 7, { align: 'right' });
                }
                doc.setProperties({ title, subject: subtitle, creator: 'RentPro', author: PROPERTY.name });
                return RentProFiles.save(doc.output('blob'), filename, 'application/pdf');
            }
        };
        return ctx;
    }

    // "Nine thousand five hundred shillings only" for receipts.
    function amountInWords(amount) {
        const ones = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve', 'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen'];
        const tens = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'];
        const under1000 = (n) => {
            const parts = [];
            if (n >= 100) { parts.push(ones[Math.floor(n / 100)] + ' hundred'); n %= 100; }
            if (n >= 20) { parts.push(tens[Math.floor(n / 10)] + (n % 10 ? '-' + ones[n % 10] : '')); }
            else if (n > 0) parts.push(ones[n]);
            return parts.join(' and ');
        };
        let n = Math.round(Math.abs(Number(amount) || 0));
        if (!n) return 'Zero shillings only';
        const chunks = [];
        [[1e9, 'billion'], [1e6, 'million'], [1e3, 'thousand']].forEach(([size, name]) => {
            if (n >= size) { chunks.push(under1000(Math.floor(n / size)) + ' ' + name); n %= size; }
        });
        if (n) chunks.push(under1000(n));
        const text = chunks.join(' ') + ' shillings only';
        return text.charAt(0).toUpperCase() + text.slice(1);
    }

    window.RentProFiles = RentProFiles;
    window.RentProPDF = { create, money, kes, dateText, amountInWords, PROPERTY };
})();
