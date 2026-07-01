/* ================================================================= */
/*  TP02.5 — Console SOC : logique applicative                       */
/*  Flux temps réel · tri · filtres avancés · synthèse KPI + graphe  */
/* ================================================================= */
document.addEventListener('DOMContentLoaded', function () {

    // ---- Sélecteurs ----
    const tbody    = document.querySelector('.events__table tbody');
    const form     = document.querySelector('.filters__form');
    const resetBtn = document.querySelector('.filters__reset');
    const ipInput  = form.querySelector('input[name="ip"]');
    const critSel  = form.querySelector('select[name="criticite"]');
    const actSel   = form.querySelector('select[name="action"]');
    const typeSel  = form.querySelector('select[name="type"]');

    const countEl  = document.getElementById('count');
    const liveBtn  = document.getElementById('toggleLive');
    const epsEl    = document.getElementById('eps');

    const statTotal   = document.getElementById('stat-total');
    const statBlocked = document.getElementById('stat-blocked');
    const statCrit    = document.getElementById('stat-crit');
    const statIp      = document.getElementById('stat-topip');
    const chartEl     = document.getElementById('chart');

    const COLS = ["Horodatage", "ID Événement", "IP Source", "Type d'Attaque", "Action Pare-feu"];
    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ---- Modèle : on hydrate depuis les lignes statiques du HTML ----
    let events = [];
    Array.from(tbody.querySelectorAll('tr:not(.events__empty)')).forEach(function (tr) {
        const c = tr.children;
        events.push({
            time:   c[0].textContent.trim(),
            id:     c[1].textContent.trim(),
            ip:     c[2].textContent.trim(),
            type:   c[3].textContent.trim(),
            action: c[4].textContent.trim(),
            crit:   tr.dataset.criticite || 'info'
        });
    });

    let sortKey = 'time', sortDir = 'desc', newId = null;

    // ---- Générateur de flux temps réel ----
    const POOL = [
        { type: 'Brute Force SSH',           crit: 'critique' },
        { type: 'SQL Injection',             crit: 'critique' },
        { type: 'Ransomware C2',             crit: 'critique' },
        { type: 'Exfiltration DNS',          crit: 'critique' },
        { type: 'Port Scan (nmap)',          crit: 'warning'  },
        { type: 'Scan Vulnérabilité',        crit: 'warning'  },
        { type: 'Login échoué RDP',          crit: 'warning'  },
        { type: 'XSS Reflected',             crit: 'warning'  },
        { type: 'Trafic anormal (interne)',  crit: 'info'     }
    ];
    const IPS = ['185.220.101.5', '45.155.205.233', '92.63.197.48', '193.106.191.20',
                 '5.188.206.18', '10.42.0.17', '192.168.1.54', '80.94.92.140', '141.98.11.29'];

    // Remplit le menu déroulant "Type d'attaque" à partir du pool
    POOL.forEach(function (p) {
        const o = document.createElement('option');
        o.value = p.type; o.textContent = p.type;
        typeSel.appendChild(o);
    });

    // Prochain numéro d'événement (à partir du max existant)
    let seq = 946;
    events.forEach(function (e) {
        const n = parseInt(e.id.replace(/\D/g, ''), 10);
        if (n >= seq) seq = n + 1;
    });

    const rand = function (a) { return a[Math.floor(Math.random() * a.length)]; };
    const nowTime = function () { return new Date().toLocaleTimeString('fr-FR', { hour12: false }); };

    function makeEvent() {
        const p = rand(POOL);
        const action = (p.crit === 'info' && Math.random() < 0.5) ? 'Autorisé' : 'Bloqué';
        return { time: nowTime(), id: 'EVT-' + (seq++), ip: rand(IPS), type: p.type, action: action, crit: p.crit };
    }

    // ---- Filtrage ----
    function passeFiltres(e) {
        const ip = ipInput.value.trim().toLowerCase();
        return (ip === '' || e.ip.toLowerCase().includes(ip))
            && (!critSel.value || e.crit === critSel.value)
            && (!actSel.value  || e.action === actSel.value)
            && (!typeSel.value || e.type === typeSel.value);
    }

    // ---- Tri ----
    function orient(n) { return sortDir === 'asc' ? n : -n; }
    function compare(a, b) {
        if (sortKey === 'ip') {
            const na = a.ip.split('.').map(Number), nb = b.ip.split('.').map(Number);
            for (let i = 0; i < 4; i++) {
                if ((na[i] || 0) !== (nb[i] || 0)) return orient((na[i] || 0) - (nb[i] || 0));
            }
            return 0;
        }
        if (sortKey === 'id') {
            return orient(parseInt(a.id.replace(/\D/g, ''), 10) - parseInt(b.id.replace(/\D/g, ''), 10));
        }
        const va = a[sortKey].toLowerCase(), vb = b[sortKey].toLowerCase();
        return orient(va < vb ? -1 : va > vb ? 1 : 0);
    }

    // ---- Rendu ----
    function tagHtml(action) {
        const cls = action === 'Bloqué' ? 'tag--blocked' : 'tag--allowed';
        return '<span class="tag ' + cls + '">' + action + '</span>';
    }

    function render() {
        const filtered = events.filter(passeFiltres).sort(compare);
        let html = '';
        filtered.forEach(function (e) {
            const flag = (e.id === newId) ? ' is-new' : '';
            html += '<tr data-criticite="' + e.crit + '" class="evrow' + flag + '">'
                  + '<td data-label="' + COLS[0] + '">' + e.time + '</td>'
                  + '<td data-label="' + COLS[1] + '">' + e.id + '</td>'
                  + '<td data-label="' + COLS[2] + '">' + e.ip + '</td>'
                  + '<td data-label="' + COLS[3] + '">' + e.type + '</td>'
                  + '<td data-label="' + COLS[4] + '">' + tagHtml(e.action) + '</td>'
                  + '</tr>';
        });
        html += '<tr class="events__empty"' + (filtered.length ? ' style="display:none"' : '')
              + '><td colspan="5" data-label="">Aucun événement ne correspond aux filtres.</td></tr>';
        tbody.innerHTML = html;
        majSynthese(filtered);
    }

    // ---- Synthèse : cartes KPI + graphe ----
    function majSynthese(list) {
        const total   = list.length;
        const blocked = list.filter(function (e) { return e.action === 'Bloqué'; }).length;
        const crit    = list.filter(function (e) { return e.crit === 'critique'; }).length;

        statTotal.textContent   = total;
        statBlocked.textContent = blocked;
        statCrit.textContent    = crit;

        const freq = {};
        list.forEach(function (e) { freq[e.ip] = (freq[e.ip] || 0) + 1; });
        let top = '—', max = 0;
        Object.keys(freq).forEach(function (ip) { if (freq[ip] > max) { max = freq[ip]; top = ip; } });
        statIp.textContent = total ? top : '—';

        countEl.textContent = total + ' événement' + (total > 1 ? 's' : '') + ' affiché' + (total > 1 ? 's' : '');

        const levels = [['critique', 'Critique'], ['warning', 'Warning'], ['info', 'Info']];
        const counts = levels.map(function (l) { return list.filter(function (e) { return e.crit === l[0]; }).length; });
        const maxC = Math.max(1, counts[0], counts[1], counts[2]);
        chartEl.innerHTML = levels.map(function (l, i) {
            const w = Math.round(counts[i] / maxC * 100);
            return '<div class="bar">'
                 + '<span class="bar__label">' + l[1] + '</span>'
                 + '<span class="bar__track"><span class="bar__fill bar--' + l[0] + '" style="width:' + w + '%"></span></span>'
                 + '<span class="bar__n">' + counts[i] + '</span>'
                 + '</div>';
        }).join('');
    }

    // ---- Tri au clic sur les en-têtes (accessible clavier via <button>) ----
    document.querySelectorAll('.th-sort').forEach(function (btn) {
        btn.addEventListener('click', function () {
            const key = btn.dataset.key;
            if (sortKey === key) { sortDir = (sortDir === 'asc') ? 'desc' : 'asc'; }
            else { sortKey = key; sortDir = 'asc'; }

            document.querySelectorAll('.events__table th').forEach(function (th) { th.removeAttribute('aria-sort'); });
            btn.closest('th').setAttribute('aria-sort', sortDir === 'asc' ? 'ascending' : 'descending');

            newId = null;
            render();
        });
    });

    // ---- Filtres (instantané + bouton) ----
    ipInput.addEventListener('input', function () { newId = null; render(); });
    [critSel, actSel, typeSel].forEach(function (el) {
        el.addEventListener('change', function () { newId = null; render(); });
    });
    form.addEventListener('submit', function (e) { e.preventDefault(); newId = null; render(); });
    resetBtn.addEventListener('click', function () { form.reset(); newId = null; render(); });

    // ---- Flux temps réel (setInterval) ----
    const CAP = 40;
    let timer = null;

    function tick() {
        const e = makeEvent();
        events.unshift(e);
        if (events.length > CAP) events = events.slice(0, CAP);
        newId = e.id;
        render();

        epsEl.textContent = (1200 + Math.floor(Math.random() * 320)).toLocaleString('fr-FR');

        // Retire le surlignage après l'animation, sans re-render global
        setTimeout(function () {
            const r = tbody.querySelector('.evrow.is-new');
            if (r) r.classList.remove('is-new');
            if (newId === e.id) newId = null;
        }, 1600);
    }

    function start() {
        if (timer) return;
        timer = setInterval(tick, 3500);
        liveBtn.textContent = '⏸ Pause';
        liveBtn.setAttribute('aria-pressed', 'true');
    }
    function stop() {
        clearInterval(timer); timer = null;
        liveBtn.textContent = '▶ Live';
        liveBtn.setAttribute('aria-pressed', 'false');
    }
    liveBtn.addEventListener('click', function () { timer ? stop() : start(); });

    // ---- Démarrage ----
    render();
    start();
});
