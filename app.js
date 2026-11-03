/* =========================================================
   KARÁCSONYI KUPA – app.js  (telefonos felület)
   Nézetek: Kör · Állás · Menetrend · (admin) Vezérlő · Beállítás
   ========================================================= */
(function () {
  'use strict';
  var L = window.Logika, MENETREND = window.MENETREND;
  var API = (window.KUPA_CONFIG || {}).API_URL || '';
  var $app = document.getElementById('app');
  var FRISSITES_MS = 5000, HATTER_FRISSITES_MS = 15000;

  // ---- Állapot ----
  var A = {
    szerver: null, offset: 0, kapcsolat: true,
    kod: tarOlvas('kupa_kod'), en: null, kodHibas: false,
    pin: tarOlvas('kupa_pin'), admin: false, pinKell: false,
    nezet: 'kor', allasFul: 'csapat', menetrendKor: null, adminKor: null,
    urlap: null, javit: null, vaz: null, vazValtozott: false,
    kodok: null, hang: false, wakeLock: null, utolsoFazis: {},
    uzenet: null, kuld: false
  };

  // ---- Segédek ----
  function tarOlvas(k) { try { return localStorage.getItem(k) || ''; } catch (e) { return ''; } }
  function tarIr(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) {} }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function most() { return Date.now() + A.offset; }
  function ido(ms) { var s = Math.max(0, Math.ceil(ms / 1000)); var p = Math.floor(s / 60); s = s % 60; return (p < 10 ? '0' : '') + p + ':' + (s < 10 ? '0' : '') + s; }
  function cfg() { return A.szerver ? A.szerver.config : null; }
  function szamF(x) { return String(x).replace('.', ','); }

  function parNev(p) { var c = cfg().csapatok[L.parCsapat(p)]; return (c.parok[p % 2] || {}).nev || ('Pár ' + (p + 1)); }
  function csapatNev(t) { return cfg().csapatok[t].nev; }
  function parTeljes(p) { return csapatNev(L.parCsapat(p)) + ' – ' + parNev(p); }
  function parTagok(p) { var c = cfg().csapatok[L.parCsapat(p)]; return ((c.parok[p % 2] || {}).tagok || []).filter(Boolean).join(', '); }

  function meccsek() { return L.meccsLista(cfg().menetrend); }
  function utolsok() { return L.utolsoBeirasok(A.szerver.beirasok); }

  // ---- Hálózat ----
  function lekeres() {
    if (!API || API.indexOf('IDE_JON') === 0) { render(true); return Promise.resolve(); }
    var t0 = Date.now();
    var url = API + '?action=state' + (A.kod && A.en === null && !A.kodHibas ? '&k=' + encodeURIComponent(A.kod) : '');
    return fetch(url).then(function (r) { return r.json(); }).then(function (v) {
      if (!v.ok) throw new Error(v.hiba || 'Szerverhiba');
      var t1 = Date.now();
      A.offset = v.most - (t0 + t1) / 2;
      if (v.en !== undefined) {
        if (v.en === null) { if (v.config.allapot === 'fut') A.kodHibas = true; }
        else A.en = v.en;
      }
      A.szerver = { config: v.config, beirasok: v.beirasok };
      A.kapcsolat = true;
      render(false);
    }).catch(function () { A.kapcsolat = false; render(false); });
  }

  function kuld(body) {
    A.kuld = true; render(true);
    return fetch(API, { method: 'POST', body: JSON.stringify(body) })
      .then(function (r) { return r.json(); })
      .then(function (v) { A.kuld = false; if (!v.ok) throw new Error(v.hiba || 'Szerverhiba'); return v; })
      .catch(function (e) { A.kuld = false; A.uzenet = { tipus: 'hiba', szoveg: e.message || 'Nincs kapcsolat' }; render(true); throw e; });
  }

  // ---- Hang, rezgés, ébren tartás ----
  var audio = null;
  function hangBe() {
    try { audio = audio || new (window.AudioContext || window.webkitAudioContext)(); audio.resume(); } catch (e) {}
    A.hang = true; ebrenTart(); csipog(880, 0.15, 0); render(true);
  }
  function ebrenTart() {
    if (!('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').then(function (w) {
      A.wakeLock = w;
      w.addEventListener('release', function () { A.wakeLock = null; });   // háttérbe tételkor elengedi
    }).catch(function () {});
  }
  function csipog(frek, hossz, kesleltet) {
    if (!audio) return;
    try {
      var o = audio.createOscillator(), g = audio.createGain(), t = audio.currentTime + kesleltet;
      o.frequency.value = frek; o.connect(g); g.connect(audio.destination);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.4, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + hossz);
      o.start(t); o.stop(t + hossz + 0.05);
    } catch (e) {}
  }
  function jelez(tipus) {
    if (tipus === 'ket') { csipog(880, 0.2, 0); csipog(880, 0.2, 0.3); if (navigator.vibrate) navigator.vibrate([200, 100, 200]); }
    else { csipog(660, 0.5, 0); csipog(660, 0.5, 0.7); csipog(440, 0.9, 1.4); if (navigator.vibrate) navigator.vibrate([500, 200, 500, 200, 800]); }
    var o = document.getElementById('ora');
    if (o) { o.classList.remove('villan'); void o.offsetWidth; o.classList.add('villan'); }
  }

  // ---- Óra frissítése (renderelés nélkül) ----
  function oraAllapot() {
    var c = cfg();
    if (!c || c.allapot !== 'fut' || !c.kor) return null;
    var h = L.hatraLevo(c, most());
    var fazis = c.korLezarva || h <= 0 ? 'lejart' : h <= 120000 ? 'ket' : 'fut';
    var felirat = c.korLezarva ? 'A KÖR VÉGET ÉRT' : c.szunetKezd ? 'SZÜNET' : h <= 0 ? 'LEJÁRT AZ IDŐ' : h <= 120000 ? 'MÉG 2 PERC!' : c.kor + '. KÖR / ' + c.menetrend.length;
    return { h: h, fazis: fazis, felirat: felirat, arany: Math.max(0, Math.min(1, h / (c.jatekPerc * 60000))) };
  }
  function tick() {
    var o = oraAllapot();
    if (!o) return;
    var c = cfg(), kulcs = String(c.kor);   // körönként figyeljük (szünet/folytatás nem nullázza)
    var elozo = A.utolsoFazis[kulcs];
    if (elozo && elozo !== o.fazis && !c.szunetKezd) {
      if (o.fazis === 'ket' && elozo === 'fut') jelez('ket');
      if (o.fazis === 'lejart') jelez('vege');
    }
    A.utolsoFazis[kulcs] = o.fazis;
    var el = document.getElementById('ora');
    if (!el) return;
    el.className = 'ora' + (o.fazis === 'ket' ? ' figyel' : o.fazis === 'lejart' ? ' lejart' : '') + (el.classList.contains('villan') ? ' villan' : '');
    document.getElementById('ora-ido').textContent = ido(o.h);
    document.getElementById('ora-felirat').textContent = o.felirat;
    document.getElementById('ora-csik').style.width = (o.arany * 100) + '%';
  }

  // ---- Renderelés ----
  function render(kenyszer) {
    var f = document.activeElement;
    if (!kenyszer && f && f.tagName === 'INPUT' && $app.contains(f)) return;  // gépelés közben nem frissítünk
    $app.innerHTML = nezetHtml();
    tick();
    if (A.nezet === 'vezerlo' && A.kodok) qrRajzol();
  }

  function nezetHtml() {
    if (!API || API.indexOf('IDE_JON') === 0) return '<div class="uzenet hiba">Nincs beállítva a szerver címe a config.js fájlban.</div>';
    if (!A.szerver) return A.kapcsolat ? '<div class="betolt">Betöltés…</div>' : '<div class="uzenet hiba">Nem érem el a szervert. Újrapróbálom…</div>';
    var h = fejHtml();
    if (!A.kapcsolat) h += '<div class="uzenet hiba">Nincs kapcsolat – újrapróbálom…</div>';
    if (A.uzenet) h += '<div class="uzenet ' + A.uzenet.tipus + '" data-akcio="uzenetBe">' + esc(A.uzenet.szoveg) + '</div>';
    if (A.pinKell) return h + pinHtml();
    if (A.urlap) return h + urlapHtml();
    if (A.javit) return h + javitHtml() + menuHtml();
    if (A.nezet === 'allas') h += allasHtml();
    else if (A.nezet === 'menetrend') h += menetrendHtml();
    else if (A.nezet === 'vezerlo' && A.admin) h += vezerloHtml();
    else if (A.nezet === 'beallitas' && A.admin) h += beallitasHtml();
    else h += korHtml();
    return h + menuHtml();
  }

  function fejHtml() {
    var jobb = A.admin ? '<span class="cimke arany">ADMIN</span>' : A.en !== null && cfg().csapatok.length ? '<span class="cimke keret">' + esc(parNev(A.en)) + '</span>' : '';
    return '<div class="fej"><div class="logo">KARÁCSONYI KUPA</div>' + jobb + '</div>';
  }

  function menuHtml() {
    var c = cfg(), gombok = [['kor', 'Kör'], ['allas', 'Állás'], ['menetrend', 'Menetrend']];
    if (A.admin) { gombok.push(['vezerlo', 'Vezérlő']); if (c.allapot !== 'fut') gombok.push(['beallitas', 'Beállítás']); }
    return '<nav class="menu"><div>' + gombok.map(function (g) {
      return '<button data-akcio="nezet" data-ertek="' + g[0] + '" class="' + (A.nezet === g[0] ? 'akt' : '') + '">' + g[1] + '</button>';
    }).join('') + '</div></nav>';
  }

  function oraHtml() {
    var o = oraAllapot();
    if (!o) return '';
    return '<div id="ora" class="ora"><span id="ora-felirat" class="kicsi" style="color:inherit">' + esc(o.felirat) + '</span>' +
      '<span id="ora-ido" class="ido">' + ido(o.h) + '</span><div class="csik"><div id="ora-csik" style="width:' + (o.arany * 100) + '%"></div></div>' +
      '<span style="font-size:12px;margin-top:4px">' + cfg().jatekPerc + ' perces kör · a szervező indítja</span></div>';
  }

  // ---- Kör nézet ----
  function korHtml() {
    var c = cfg(), h = '';
    if (c.allapot !== 'fut') return h + '<div class="sotet"><h2>A verseny még nem kezdődött el</h2><span class="halv">Amint a szervező elindítja, itt látjátok a köröket.</span></div>';
    if (!A.hang) h += '<button class="gomb masod szeles" data-akcio="hangBe">Hang és ébren tartás bekapcsolása</button>';
    if (!c.kor) h += '<div class="sotet"><h2>Hamarosan kezdünk</h2><span class="halv">Az 1. kört a szervező indítja.</span></div>';
    else h += oraHtml();
    if (A.kodHibas) h += '<div class="uzenet hiba">Ez a pár-kód nem érvényes. Írjátok be újra.</div>';

    var r = c.kor || 1, u = utolsok();
    if (A.en !== null) {
      var t = L.parCsapat(A.en);
      h += '<div class="kicsi">' + esc(csapatNev(t)) + ' · ' + (c.kor ? c.kor + '. kör' : 'első kör') + '</div>';
      [A.en, A.en % 2 ? A.en - 1 : A.en + 1].forEach(function (p, i) {
        h += sajatMeccsHtml(p, r, u, i === 0);
      });
    } else {
      h += kodBeiroHtml();
      if (c.kor) h += korMeccseiHtml(c.kor, u, false);
    }
    return h;
  }

  function sajatMeccsHtml(p, r, u, sajat) {
    var t = L.parCsapat(p), m = meccsek().filter(function (x) {
      return x.kor === r && (x.tipus === 'BOW' ? x.csapat === t : (x.a === p || x.b === p));
    })[0];
    var fej = '<div class="sor"><span class="kicsi">' + esc(parNev(p)) + (sajat ? ' (ti)' : ' (csapattárs)') + '</span>';
    if (!m) return '<div class="kartya">' + fej + '<span class="cimke ures">pihenő</span></div><div class="cim" style="font-size:20px">Ebben a körben pihentek</div></div>';
    var st = L.meccsAllapot(m, u);
    var h = '<div class="kartya">' + fej + allapotCimke(st, m) + '</div>';
    h += '<div class="cim" style="font-size:22px">' + esc(L.ALLOMASOK[m.allomas].nev) + '</div>';
    if (m.tipus === 'BOW') h += '<div style="font-size:14px">Az egész csapat együtt gurít (Baker, 10 frame)</div>';
    else h += '<div style="font-size:14px">vs. <b>' + esc(parTeljes(m.a === p ? m.b : m.a)) + '</b></div>';
    var oss = osszegzes(m, st, p);
    if (oss) h += '<div style="font-size:15px;font-weight:600">' + esc(oss) + '</div>';
    if (sajat && r <= cfg().kor) h += '<button class="gomb sotetg" data-akcio="beir" data-meccs="' + m.id + '">' + (st.allapot === 'ures' ? 'Eredmény beírása' : 'Beírás javítása') + '</button>';
    return h + '</div>';
  }

  function kodBeiroHtml() {
    return '<div class="sotet"><span class="kicsi">Pár-kód</span><span class="halv" style="font-size:14px">A QR-kódból automatikusan bekerül. Ha nem, írjátok be ide:</span>' +
      '<div class="racs2"><input class="mezo" id="kodmezo" autocapitalize="characters" placeholder="pl. K7QM2X"><button class="gomb fo" data-akcio="kodMent">Belépés</button></div></div>';
  }

  function allapotCimke(st, m) {
    if (st.allapot === 'ok') return '<span class="cimke ok">' + (st.admin ? '✓ szervező döntött' : m.tipus === 'BOW' ? '✓ beírva' : '✓ elfogadva') + '</span>';
    if (st.allapot === 'utkozes') return '<span class="cimke hiba">ütközés</span>';
    if (st.allapot === 'felig') return '<span class="cimke var">1/2 beírva</span>';
    return '<span class="cimke ures">nincs beírva</span>';
  }

  // Eredmény szövegesen, a "p" pár szemszögéből (p nélkül: a – b sorrend)
  function osszegzes(m, st, p) {
    if (m.tipus === 'BOW') return st.allapot === 'ok' ? st.fa + ' fa' : '';
    if (!st.da || !st.db) return '';
    var forditva = p !== undefined && p === m.b;
    var x = forditva ? st.db : st.da, y = forditva ? st.da : st.db, s;
    if (m.tipus === 'CSOCSO') s = x.gol + ' : ' + y.gol;
    else if (m.tipus === 'DARTS') s = 'maradt ' + x.marad + ' : ' + y.marad;
    else if (m.tipus === 'BIL') s = 'fent maradt ' + x.fent + ' : ' + y.fent;
    else s = x.pont + ' : ' + y.pont + (x.kesz && y.kesz ? ' (3 end)' : ' (idő)');
    if (st.allapot === 'ok') {
      var g = st.gyoztes;
      if (g === 'd') s += ' – döntetlen';
      else if (p === undefined) s += ' – ' + parNev(g === 'a' ? m.a : m.b) + ' nyert';
      else s += ((g === 'a') !== forditva ? ' – győzelem' : ' – vereség');
    }
    return s;
  }

  function korMeccseiHtml(r, u, admin) {
    var h = '<div class="kartya" style="padding:4px 14px;gap:0">';
    meccsek().filter(function (m) { return m.kor === r; }).forEach(function (m) {
      var st = L.meccsAllapot(m, u);
      var resztv = m.tipus === 'BOW' ? csapatNev(m.csapat) : parNev(m.a) + ' – ' + parNev(m.b);
      var oss = osszegzes(m, st);
      h += '<div class="meccssor"' + (admin ? ' data-akcio="javit" data-meccs="' + m.id + '" style="cursor:pointer"' : '') + '>' +
        '<div class="bal"><b>' + esc(L.ALLOMASOK[m.allomas].nev) + '</b><span>' + esc(resztv) + (oss ? ' · ' + esc(oss) : '') + '</span></div>' + allapotCimke(st, m) + '</div>';
    });
    return h + '</div>';
  }

  // ---- Beírás űrlap ----
  function alapAdat(tipus) {
    return { CSOCSO: { gol: 0 }, DARTS: { marad: 301 }, BIL: { nyolcas: 'mi', fent: 0 }, SHUF: { pont: 0, kesz: true }, BOW: { fa: 0 } }[tipus];
  }
  function urlapNyit(meccsId, oldal, admin) {
    var m = meccsek().filter(function (x) { return x.id === meccsId; })[0];
    if (!m) return;
    var meglevo = utolsok()[L.oldalKulcs(m.id, oldal)];
    A.urlap = { m: m, oldal: oldal, admin: !!admin, adat: JSON.parse(JSON.stringify(meglevo ? meglevo.adat : alapAdat(m.tipus))) };
    A.uzenet = null;
    lekeres();   // friss adat: az ellenfél legutóbbi beírása is látsszon
  }

  function lepteto(mezo, ertek, min, max) {
    return '<div class="lepteto"><button aria-label="Kevesebb" data-akcio="lep" data-mezo="' + mezo + '" data-d="-1" data-min="' + min + '" data-max="' + max + '">−</button>' +
      '<span class="ertek">' + ertek + '</span><button aria-label="Több" data-akcio="lep" data-mezo="' + mezo + '" data-d="1" data-min="' + min + '" data-max="' + max + '">+</button></div>';
  }
  function valaszto(mezo, aktualis, opciok) {
    return '<div class="racs' + opciok.length + '">' + opciok.map(function (o) {
      return '<button class="gomb ' + (String(aktualis) === String(o[0]) ? 'valasztva' : 'vilagos') + '" data-akcio="valaszt" data-mezo="' + mezo + '" data-ertek="' + o[0] + '">' + o[1] + '</button>';
    }).join('') + '</div>';
  }

  function urlapHtml() {
    var U = A.urlap, m = U.m, d = U.adat, h = '';
    var sajatPar = U.oldal.charAt(0) === 'p' ? Number(U.oldal.slice(1)) : null;
    h += '<div class="sor"><button class="gomb masod" data-akcio="urlapBe">← Vissza</button><span class="kicsi">' + m.kor + '. kör</span></div>';
    var cim = m.tipus === 'BOW' ? csapatNev(m.csapat) : parNev(sajatPar) + ' vs. ' + parNev(sajatPar === m.a ? m.b : m.a);
    h += '<div><div class="kicsi">' + esc(cim) + (U.admin ? ' · SZERVEZŐI JAVÍTÁS' : '') + '</div><h1>' + esc(L.ALLOMASOK[m.allomas].nev) + '</h1></div>';
    if (m.tipus === 'CSOCSO') {
      h += '<div class="kartya"><b>Hány gólt rúgtatok?</b>' + lepteto('gol', d.gol, 0, 10) + '<span class="kicsi">10 gólig megy · ha lejár az idő, döntetlen</span></div>';
    } else if (m.tipus === 'DARTS') {
      h += '<div class="kartya"><b>Hány pont maradt nálatok?</b><input class="szammezo" inputmode="numeric" data-szam="marad" data-min="0" data-max="301" value="' + d.marad + '">' +
        '<button class="gomb ' + (d.marad === 0 ? 'valasztva' : 'vilagos') + '" data-akcio="valaszt" data-mezo="marad" data-ertek="0">Kiszálltunk (0)</button><span class="kicsi">301 · szimpla be, szimpla ki</span></div>';
    } else if (m.tipus === 'BIL') {
      h += '<div class="kartya"><b>Ki tette le szabályosan a 8-ast?</b>' + valaszto('nyolcas', d.nyolcas, [['mi', 'Mi'], ['ellen', 'Ellenfél'], ['senki', 'Senki (idő)']]) + '</div>';
      h += '<div class="kartya"><b>Hány SAJÁT golyótok maradt fent?</b>' + lepteto('fent', d.fent, 0, 7) + '</div>';
    } else if (m.tipus === 'SHUF') {
      h += '<div class="kartya"><b>Hány pontotok lett?</b>' + lepteto('pont', d.pont, 0, 99) + '</div>';
      h += '<div class="kartya"><b>Lement a 3 end?</b>' + valaszto('kesz', d.kesz, [['true', 'Igen, 3 end'], ['false', 'Lejárt az idő']]) + '</div>';
    } else if (m.tipus === 'BOW') {
      h += '<div class="kartya"><b>Hány fát gurított a csapat összesen?</b><input class="szammezo" inputmode="numeric" data-szam="fa" data-min="0" data-max="300" value="' + d.fa + '"><span class="kicsi">10 frame, Baker-rendszer · 0–300</span></div>';
    }
    if (m.tipus !== 'BOW' && !U.admin) {
      var masik = utolsok()[L.oldalKulcs(m.id, 'p' + (sajatPar === m.a ? m.b : m.a))];
      if (masik) {
        var proba = {}; proba[L.oldalKulcs(m.id, U.oldal)] = { adat: d }; proba[L.oldalKulcs(m.id, masik.oldal)] = masik;
        var st = L.meccsAllapot(m, proba);
        h += '<div class="sotet"><span class="kicsi">Az ellenfél beírta</span><span>' + esc(adatSzoveg(m.tipus, masik.adat)) + '</span>' +
          (st.allapot === 'ok' ? '<span style="color:#8FD3A8;font-weight:600">✓ Egyezik – elfogadva lesz</span>' : '<span style="color:#F2A08F;font-weight:600">Ütközik – a szervező dönt, ha így küldöd</span>') + '</div>';
      } else h += '<div class="uzenet info">Az ellenfél még nem írta be a sajátját.</div>';
    }
    h += '<button class="gomb fo nagy" data-akcio="kuldes"' + (A.kuld ? ' disabled' : '') + '>' + (A.kuld ? 'Küldés…' : 'Beküldés') + '</button>';
    return h;
  }

  function adatSzoveg(tipus, d) {
    if (!d) return '–';
    if (tipus === 'CSOCSO') return d.gol + ' gól';
    if (tipus === 'DARTS') return d.marad === 0 ? 'kiszállt (0)' : d.marad + ' pont maradt';
    if (tipus === 'BIL') return { mi: 'ők tették le a 8-ast', ellen: 'szerintük az ellenfél nyert', senki: 'lejárt az idő' }[d.nyolcas] + ', ' + d.fent + ' golyó fent';
    if (tipus === 'SHUF') return d.pont + ' pont, ' + (d.kesz ? '3 end lement' : 'lejárt az idő');
    if (tipus === 'BOW') return d.fa + ' fa';
    return '';
  }

  // ---- Admin: meccs javítása ----
  function javitHtml() {
    var m = meccsek().filter(function (x) { return x.id === A.javit; })[0];
    var u = utolsok(), st = L.meccsAllapot(m, u), h = '';
    h += '<div class="sor"><button class="gomb masod" data-akcio="javitBe">← Vissza</button><span class="kicsi">' + m.kor + '. kör</span></div>';
    h += '<div class="sor"><h1>' + esc(L.ALLOMASOK[m.allomas].nev) + '</h1>' + allapotCimke(st, m) + '</div>';
    if (m.tipus === 'BOW') {
      var bw = u[L.oldalKulcs(m.id, 't' + m.csapat)];
      h += '<div class="kartya"><b>' + esc(csapatNev(m.csapat)) + '</b><span>' + esc(bw ? adatSzoveg('BOW', bw.adat) : 'még nincs beírva') + '</span>' +
        '<button class="gomb sotetg" data-akcio="adminUrlap" data-oldal="t' + m.csapat + '">Fák beírása / javítása</button></div>';
      return h;
    }
    [m.a, m.b].forEach(function (p) {
      var e = u[L.oldalKulcs(m.id, 'p' + p)];
      h += '<div class="kartya"><b>' + esc(parTeljes(p)) + '</b><span>' + esc(e ? adatSzoveg(m.tipus, e.adat) + (e.forras === 'admin' ? ' (szervező írta)' : '') : 'még nincs beírva') + '</span>' +
        '<button class="gomb vilagos" data-akcio="adminUrlap" data-oldal="p' + p + '">Az ő adatuk szerkesztése</button></div>';
    });
    var ad = u[L.oldalKulcs(m.id, 'admin')];
    h += '<div class="sotet"><span class="kicsi">Szervezői döntés (felülír mindent)</span>' +
      '<button class="gomb fo" data-akcio="dont" data-ertek="a">' + esc(parNev(m.a)) + ' nyert</button>' +
      '<button class="gomb fo" data-akcio="dont" data-ertek="b">' + esc(parNev(m.b)) + ' nyert</button>' +
      '<button class="gomb masod" data-akcio="dont" data-ertek="d">Döntetlen</button>' +
      (ad ? '<button class="gomb vesz" data-akcio="dont" data-ertek="">Döntés törlése</button>' : '') + '</div>';
    return h;
  }

  // ---- Állás ----
  function allasHtml() {
    var c = cfg(), h = '<div class="sor"><h1>Állás</h1><span class="kicsi">' + (c.kor ? c.kor + '. kör' : '') + '</span></div>';
    if (!c.menetrend) return h + '<div class="sotet"><span class="halv">A verseny még nem kezdődött el.</span></div>';
    var a = L.allasSzamol(c, A.szerver.beirasok);
    h += '<div class="fulek">' + [['csapat', 'Csapat'], ['paros', 'Páros'], ['bowling', 'Bowling']].map(function (f) {
      return '<button data-akcio="allasFul" data-ertek="' + f[0] + '" class="' + (A.allasFul === f[0] ? 'akt' : '') + '">' + f[1] + '</button>';
    }).join('') + '</div>';
    if (A.allasFul === 'bowling') {
      h += '<div class="tabla"><div class="tsor fej2" style="grid-template-columns:26px minmax(0,1fr) 84px 46px"><span>#</span><span>CSAPAT</span><span class="j">FA</span><span class="j">P</span></div>';
      a.bowling.forEach(function (b, i) {
        h += '<div class="tsor" style="grid-template-columns:26px minmax(0,1fr) 84px 46px"><span class="hely">' + (i + 1) + '</span><span class="nev">' + esc(b.nev) + '<small>' + (b.fak.length ? b.fak.join(' + ') : 'még nincs') + '</small></span>' +
          '<span class="j"><b>' + b.ossz + '</b></span><span class="j">' + (a.bowlingKesz ? szamF(b.pont) : '–') + '</span></div>';
      });
      h += '</div><div class="sotet"><span class="kicsi" style="color:var(--arany)">Bowlingpontok: a végén</span><span style="font-size:13px;color:var(--szoveg2)">' +
        a.bowlingDb + ' / ' + (2 * c.csapatok.length) + ' játék beírva. A helyezés szerinti 0–' + L.BOWLING_MAX_PONT + ' pont az utolsó bowling után kerül a táblába (a pár a felét kapja).</span></div>';
      return h;
    }
    var lista = A.allasFul === 'paros' ? a.parok : a.csapatok;
    h += '<div class="tabla"><div class="tsor fej2"><span>#</span><span>' + (A.allasFul === 'paros' ? 'PÁR' : 'CSAPAT') + '</span><span class="j">P</span><span class="j">GY</span><span class="j">FÖL</span></div>';
    lista.forEach(function (x, i) {
      var dob = A.allasFul === 'paros' && i < 3;
      h += '<div class="tsor' + (dob || (A.allasFul === 'csapat' && i === 0) ? ' dobogo' : '') + '"><span class="hely">' + (i + 1) + '</span>' +
        '<span class="nev">' + esc(x.nev) + (A.allasFul === 'paros' ? '<small>' + esc(x.csapatNev) + '</small>' : '') + '</span>' +
        '<span class="j"><b>' + szamF(x.pont) + '</b></span><span class="j">' + x.gy + '</span><span class="j" style="color:var(--szurke)">' + szamF(x.fol.toFixed(2)) + '</span></div>';
    });
    h += '</div><span class="kicsi" style="text-transform:none">P = pont (3-1-0' + (a.bowlingKesz ? ' + bowling' : '') + ') · GY = győzelem · FÖL = fölény-index · holtversenynél: GY, FÖL, Buchholz</span>';
    return h;
  }

  // ---- Menetrend ----
  function menetrendHtml() {
    var c = cfg(), h = '<h1>Menetrend</h1>';
    if (!c.menetrend) return h + '<div class="sotet"><span class="halv">A menetrend a sorsolás és a start után jelenik meg.</span></div>';
    var R = c.menetrend.length, lista = meccsek();
    if (A.en !== null) {
      var t = L.parCsapat(A.en);
      h += '<div class="kicsi">' + esc(parTeljes(A.en)) + '</div><div class="kartya" style="padding:4px 14px;gap:0">';
      for (var r = 1; r <= R; r++) {
        var m = lista.filter(function (x) { return x.kor === r && (x.tipus === 'BOW' ? x.csapat === t : (x.a === A.en || x.b === A.en)); })[0];
        var szoveg = !m ? 'Pihenő' : m.tipus === 'BOW' ? 'Az egész csapat' : 'vs. ' + parTeljes(m.a === A.en ? m.b : m.a);
        h += '<div class="meccssor"' + (r === c.kor ? ' style="background:var(--var-h);margin:0 -14px;padding:12px 14px"' : '') + '><div class="bal"><b>' + r + '. kör · ' + esc(m ? L.ALLOMASOK[m.allomas].nev : '—') + '</b><span>' + esc(szoveg) + '</span></div></div>';
      }
      h += '</div>';
    }
    var k = A.menetrendKor || c.kor || 1;
    h += '<div class="kicsi">Teljes menetrend</div><div class="korvalaszto">';
    for (var i = 1; i <= R; i++) h += '<button data-akcio="menetrendKor" data-ertek="' + i + '" class="' + (i === k ? 'akt' : '') + '">' + i + '</button>';
    h += '</div>' + korMeccseiHtml(k, utolsok(), false);
    var pihenok = [];
    for (var p = 0; p < 2 * c.csapatok.length; p++) {
      var van = lista.some(function (x) { return x.kor === k && (x.tipus === 'BOW' ? x.csapat === L.parCsapat(p) : (x.a === p || x.b === p)); });
      if (!van) pihenok.push(parTeljes(p));
    }
    if (pihenok.length) h += '<div class="uzenet info">Pihen: ' + esc(pihenok.join(', ')) + '</div>';
    return h;
  }

  // ---- Admin: PIN ----
  function pinHtml() {
    return '<div class="sotet"><h2>Szervezői belépés</h2><input class="mezo" id="pinmezo" type="password" inputmode="numeric" placeholder="PIN">' +
      '<div class="racs2"><button class="gomb masod" data-akcio="pinMegse">Mégse</button><button class="gomb fo" data-akcio="pinBe">Belépés</button></div></div>';
  }

  // ---- Admin: vezérlő ----
  function vezerloHtml() {
    var c = cfg(), h = '<h1>Vezérlő</h1>';
    if (c.allapot !== 'fut') {
      return h + '<div class="sotet"><span>A verseny még nincs elindítva. Csapatok, sorsolás és Start a <b>Beállítás</b> fülön.</span></div>' + veszelyHtml();
    }
    var R = c.menetrend.length, u = utolsok();
    h += oraHtml();
    if (!c.kor) h += '<button class="gomb fo nagy" data-akcio="kor" data-ertek="kovetkezo">1. kör indítása</button>';
    else {
      h += '<div class="racs2">' + (c.szunetKezd ? '<button class="gomb masod" data-akcio="kor" data-ertek="folytat">Folytatás</button>' :
        '<button class="gomb masod" data-akcio="kor" data-ertek="szunet"' + (c.korLezarva ? ' disabled' : '') + '>Szünet</button>') +
        '<button class="gomb vesz" data-akcio="kor" data-ertek="lezar"' + (c.korLezarva ? ' disabled' : '') + '>Kör lezárása</button></div>';
      if (c.kor < R) {
        var hianyBow = meccsek().filter(function (m) { return m.kor === c.kor && m.tipus === 'BOW' && L.meccsAllapot(m, u).allapot !== 'ok'; }).length;
        h += '<button class="gomb fo nagy" data-akcio="kor" data-ertek="kovetkezo">' + (c.kor + 1) + '. kör indítása' + (hianyBow ? ' (' + hianyBow + ' bowling még nincs beírva)' : '') + '</button>';
      } else h += '<div class="uzenet ok">Ez az utolsó kör. Ha minden beírás kész, a végeredmény az Állás fülön van.</div>';
    }
    var k = A.adminKor || c.kor || 1;
    var db = { ok: 0, felig: 0, ures: 0, utkozes: 0 };
    meccsek().filter(function (m) { return m.kor === k; }).forEach(function (m) { db[L.meccsAllapot(m, u).allapot]++; });
    h += '<div class="racs3"><div class="cimke ok" style="border-radius:12px;padding:10px">' + db.ok + ' elfogadva</div><div class="cimke var" style="border-radius:12px;padding:10px">' +
      (db.felig + db.ures) + ' hiányzik</div><div class="cimke hiba" style="border-radius:12px;padding:10px">' + db.utkozes + ' ütközés</div></div>';
    h += '<div class="korvalaszto">';
    for (var i = 1; i <= R; i++) h += '<button data-akcio="adminKor" data-ertek="' + i + '" class="' + (i === k ? 'akt' : '') + '">' + i + '</button>';
    h += '</div><span class="kicsi" style="text-transform:none">Koppints egy meccsre a javításhoz.</span>' + korMeccseiHtml(k, u, true);
    h += '<div class="sotet"><span class="kicsi">Párok linkjei és QR-kódjai</span>';
    if (!A.kodok) h += '<button class="gomb masod" data-akcio="kodok">Megjelenítés</button>';
    else {
      h += '<div class="qrlista">';
      A.kodok.forEach(function (k2) {
        h += '<div class="qrkartya"><b>' + esc(parTeljes(k2.par)) + '</b><div class="qr" id="qr-' + k2.par + '"></div><span class="kod">' + esc(k2.kod) + '</span></div>';
      });
      h += '</div><button class="gomb masod" data-akcio="kodokBe">Elrejtés</button>';
    }
    return h + '</div>' + veszelyHtml();
  }
  function veszelyHtml() {
    return '<div class="sotet" style="border:1px dashed var(--piros)"><span class="kicsi" style="color:var(--hiba-vil)">Veszélyes zóna</span>' +
      '<span style="font-size:13px;color:var(--szoveg2)">Minden törlése: csapatok, menetrend, eredmények, kódok. Teszt után ezzel indulsz tiszta lappal.</span>' +
      '<button class="gomb vesz" data-akcio="torles">Minden törlése</button><button class="gomb masod" data-akcio="kilep">Kilépés az admin módból</button></div>';
  }
  function parLink(kod) { return location.origin + location.pathname + '?k=' + encodeURIComponent(kod); }
  function qrRajzol() {
    if (!window.QRCode) return;
    A.kodok.forEach(function (k) {
      var el = document.getElementById('qr-' + k.par);
      if (el && !el.firstChild) new window.QRCode(el, { text: parLink(k.kod), width: 130, height: 130, correctLevel: window.QRCode.CorrectLevel.M });
    });
  }

  // ---- Admin: beállítás ----
  function vazBetolt() {
    var c = cfg();
    A.vaz = { jatekosok: c.jatekosok, osszIdo: c.osszIdo, jatekPerc: c.jatekPerc, valtasPerc: c.valtasPerc, csapatok: JSON.parse(JSON.stringify(c.csapatok || [])) };
    vazMeretez(); A.vazValtozott = false;
  }
  function vazMeretez() {
    var b = L.csapatBeosztas(A.vaz.jatekosok);
    if (!b) return;
    while (A.vaz.csapatok.length < b.csapat) A.vaz.csapatok.push({ nev: '', parok: [{ nev: '', tagok: ['', '', ''] }, { nev: '', tagok: ['', '', ''] }] });
    A.vaz.csapatok.length = b.csapat;
    A.vaz.csapatok.forEach(function (cs) {
      cs.parok = cs.parok || [];
      while (cs.parok.length < 2) cs.parok.push({ nev: '', tagok: [] });
      cs.parok.forEach(function (p) { p.tagok = p.tagok || []; while (p.tagok.length < 3) p.tagok.push(''); });
    });
  }
  function vazStat() {
    var harmas = 0, tagok = 0;
    A.vaz.csapatok.forEach(function (cs) { cs.parok.forEach(function (p) { var n = p.tagok.filter(function (t) { return String(t).trim(); }).length; tagok += n; if (n === 3) harmas++; }); });
    return { harmas: harmas, tagok: tagok };
  }

  function beallitasHtml() {
    if (!A.vaz) vazBetolt();
    var V = A.vaz, b = L.csapatBeosztas(V.jatekosok), R = L.korokSzama(b.csapat), st = vazStat();
    var h = '<h1>Beállítás</h1>';
    h += '<div class="sotet"><span class="kicsi">Hány játékos van?</span>' + lepteto('v.jatekosok', V.jatekosok, L.MIN_JATEKOS, L.MAX_JATEKOS) +
      '<span class="halv" style="font-size:13px;text-align:center">' + L.MIN_JATEKOS + '–' + L.MAX_JATEKOS + ' fő</span></div>';
    h += '<div class="kartya"><span class="kicsi">A rendszer így osztja</span><div class="racs3">' +
      '<div><div class="cim" style="font-size:32px">' + b.csapat + '</div>csapat</div><div><div class="cim" style="font-size:32px">' + 2 * b.csapat + '</div>pár</div>' +
      '<div><div class="cim" style="font-size:32px;color:var(--piros)">' + b.harmas + '</div>hármas pár</div></div>' +
      '<span style="font-size:14px">' + (b.csapat * 4) + ' fő = ' + b.csapat + ' × 4 fős csapat' + (b.harmas ? '. A maradék ' + b.harmas + ' fő ' + b.harmas + ' párt egészít ki hármasra.' : '.') + '</span></div>';
    h += '<div class="sotet"><span class="kicsi">Teljes időkeret (perc)</span>' + lepteto('v.osszIdo', V.osszIdo, 60, 300) +
      '<span class="kicsi">Játékidő körönként (perc)</span>' + lepteto('v.jatekPerc', V.jatekPerc, 3, 60) +
      '<span class="kicsi">Váltás körönként (perc)</span>' + lepteto('v.valtasPerc', V.valtasPerc, 0, 15) +
      '<span style="font-size:14px;color:var(--szoveg2)">→ <b style="color:var(--krem)">' + R + ' kör</b> × (' + V.jatekPerc + ' + ' + V.valtasPerc + ') = ' + R * (V.jatekPerc + V.valtasPerc) + ' perc</span></div>';
    h += '<div class="sor"><h2>Csapatok</h2><span class="kicsi">hármas pár: ' + st.harmas + ' / ' + b.harmas + ' · fő: ' + st.tagok + ' / ' + V.jatekosok + '</span></div>';
    V.csapatok.forEach(function (cs, ci) {
      h += '<div class="kartya csapatkartya"><label class="mezocim">' + (ci + 1) + '. CSAPAT NEVE<input class="mezo" data-vaz="' + ci + '.nev" value="' + esc(cs.nev) + '" maxlength="30"></label><div class="racs2">';
      cs.parok.forEach(function (p, pi) {
        h += '<div class="parblokk"><label class="mezocim">' + (pi ? 'B' : 'A') + ' PÁR NEVE<input class="mezo" data-vaz="' + ci + '.p' + pi + '.nev" value="' + esc(p.nev) + '" maxlength="30"></label>';
        for (var ti = 0; ti < 3; ti++) {
          h += '<input class="mezo" aria-label="' + (ti + 1) + '. tag" placeholder="' + (ti < 2 ? (ti + 1) + '. tag' : '3. tag (hármasnál)') + '" data-vaz="' + ci + '.p' + pi + '.t' + ti + '" value="' + esc(p.tagok[ti]) + '" maxlength="40">';
        }
        h += '</div>';
      });
      h += '</div></div>';
    });
    if (st.harmas !== b.harmas) h += '<div class="uzenet hiba">' + b.harmas + ' hármas pár kell, most ' + st.harmas + ' van megadva.</div>';
    h += '<button class="gomb masod" data-akcio="vazMent">Mentés' + (A.vazValtozott ? ' (van mentetlen)' : '') + '</button>';
    h += '<div class="racs2"><button class="gomb masod" data-akcio="sorsol" style="color:var(--arany);border-color:var(--arany)">Sorsolás</button><button class="gomb fo" data-akcio="start">Start (zárol)</button></div>';
    h += '<span class="kicsi" style="text-transform:none">A Sorsolás véletlenszerűen osztja a csapatokat a menetrend helyeire. A Start után nem lehet szerkeszteni (csak Minden törlésével).</span>';
    return h;
  }
  function vazBeir(ut, ertek) {
    var r = ut.split('.'), cs = A.vaz.csapatok[Number(r[0])];
    if (r[1] === 'nev') cs.nev = ertek;
    else {
      var p = cs.parok[Number(r[1].slice(1))];
      if (r[2] === 'nev') p.nev = ertek; else p.tagok[Number(r[2].slice(1))] = ertek;
    }
    A.vazValtozott = true;
  }
  function vazKuld() {
    var V = A.vaz;
    return kuld({ action: 'beallitas', pin: A.pin, jatekosok: V.jatekosok, osszIdo: V.osszIdo, jatekPerc: V.jatekPerc, valtasPerc: V.valtasPerc,
      csapatok: V.csapatok.map(function (cs) { return { nev: cs.nev, parok: cs.parok.map(function (p) { return { nev: p.nev, tagok: p.tagok.filter(function (t) { return String(t).trim(); }) }; }) }; }) })
      .then(function () { A.vazValtozott = false; return lekeres(); });
  }

  // ---- Események ----
  var AKCIO = {
    nezet: function (d) { A.nezet = d.ertek; A.javit = null; A.urlap = null; if (d.ertek === 'beallitas') vazBetolt(); else lekeres(); },
    uzenetBe: function () { A.uzenet = null; },
    hangBe: function () { hangBe(); },
    allasFul: function (d) { A.allasFul = d.ertek; },
    menetrendKor: function (d) { A.menetrendKor = Number(d.ertek); },
    adminKor: function (d) { A.adminKor = Number(d.ertek); },
    beir: function (d) {
      var m = meccsek().filter(function (x) { return x.id === d.meccs; })[0];
      urlapNyit(d.meccs, m.tipus === 'BOW' ? 't' + m.csapat : 'p' + A.en, false);
    },
    urlapBe: function () { A.urlap = null; },
    lep: function (d) {
      var min = Number(d.min), max = Number(d.max), dd = Number(d.d);
      if (d.mezo.indexOf('v.') === 0) {
        var k = d.mezo.slice(2);
        A.vaz[k] = Math.max(min, Math.min(max, A.vaz[k] + dd));
        if (k === 'jatekosok' || k === 'osszIdo' || k === 'valtasPerc') {
          if (k === 'jatekosok') vazMeretez();
          A.vaz.jatekPerc = L.jatekPercSzamol(A.vaz.osszIdo, L.csapatBeosztas(A.vaz.jatekosok).csapat, A.vaz.valtasPerc);
        }
        A.vazValtozott = true;
      } else A.urlap.adat[d.mezo] = Math.max(min, Math.min(max, A.urlap.adat[d.mezo] + dd));
    },
    valaszt: function (d) {
      var v = d.ertek === 'true' ? true : d.ertek === 'false' ? false : /^\d+$/.test(d.ertek) ? Number(d.ertek) : d.ertek;
      A.urlap.adat[d.mezo] = v;
    },
    kuldes: function () {
      var U = A.urlap;
      if (!L.ervenyesAdat(U.m.tipus, U.adat)) { A.uzenet = { tipus: 'hiba', szoveg: 'Hibás érték – nézd át a számokat.' }; return; }
      var body = U.admin ? { action: 'adminBeir', pin: A.pin, meccs: U.m.id, oldal: U.oldal, adat: U.adat } : { action: 'beir', k: A.kod, meccs: U.m.id, adat: U.adat };
      kuld(body).then(function () { A.urlap = null; A.uzenet = { tipus: 'ok', szoveg: 'Elküldve ✓' }; setTimeout(function () { A.uzenet = null; render(false); }, 2500); return lekeres(); });
    },
    kodMent: function () {
      var v = (document.getElementById('kodmezo').value || '').trim().toUpperCase();
      if (!v) return;
      A.kod = v; A.en = null; A.kodHibas = false; tarIr('kupa_kod', v); lekeres();
    },
    pinBe: function () {
      var v = document.getElementById('pinmezo').value;
      A.pin = v;
      kuld({ action: 'pin', pin: v }).then(function () { A.admin = true; A.pinKell = false; tarIr('kupa_pin', v); A.nezet = cfg().allapot === 'fut' ? 'vezerlo' : 'beallitas'; if (A.nezet === 'beallitas') vazBetolt(); render(true); })
        .catch(function () { A.pin = ''; });
    },
    pinMegse: function () { A.pinKell = false; },
    kilep: function () { A.admin = false; A.pin = ''; tarIr('kupa_pin', ''); A.nezet = 'kor'; A.kodok = null; },
    kor: function (d) {
      var c = cfg();
      if (d.ertek === 'kovetkezo' && c.kor && !confirm((c.kor + 1) + '. kör indítása?')) return;
      if (d.ertek === 'lezar' && !confirm('Lezárod a kört? Az óra 0-ra áll.')) return;
      kuld({ action: 'kor', pin: A.pin, cmd: d.ertek }).then(function () { A.adminKor = null; return lekeres(); });
    },
    javit: function (d) { A.javit = d.meccs; },
    javitBe: function () { A.javit = null; },
    adminUrlap: function (d) { urlapNyit(A.javit, d.oldal, true); },
    dont: function (d) {
      kuld({ action: 'adminBeir', pin: A.pin, meccs: A.javit, oldal: 'admin', adat: d.ertek ? { gyoztes: d.ertek } : null }).then(function () { return lekeres(); });
    },
    kodok: function () { kuld({ action: 'kodok', pin: A.pin }).then(function (v) { A.kodok = v.kodok; render(true); }); },
    kodokBe: function () { A.kodok = null; },
    torles: function () {
      var v = prompt('Minden adat törlődik. Ha biztos vagy, írd be: TÖRLÉS');
      if (v === null) return;
      kuld({ action: 'torles', pin: A.pin, megerosites: v.trim().toUpperCase() }).then(function () {
        A.kodok = null; A.vaz = null; A.en = null; A.nezet = 'beallitas'; A.uzenet = { tipus: 'ok', szoveg: 'Minden törölve.' }; return lekeres();
      }).then(function () { vazBetolt(); render(true); });
    },
    vazMent: function () { vazKuld().then(function () { A.uzenet = { tipus: 'ok', szoveg: 'Mentve ✓' }; render(true); }); },
    sorsol: function () {
      if (!confirm('Sorsolás: a csapatok véletlenszerűen kerülnek a menetrend helyeire. Mehet?')) return;
      var cs = A.vaz.csapatok;
      for (var i = cs.length - 1; i > 0; i--) { var j = Math.floor(Math.random() * (i + 1)); var x = cs[i]; cs[i] = cs[j]; cs[j] = x; }
      vazKuld().then(function () { A.uzenet = { tipus: 'ok', szoveg: 'Sorsolás kész és mentve ✓' }; render(true); });
    },
    start: function () {
      var b = L.csapatBeosztas(A.vaz.jatekosok), st = vazStat();
      var figy = st.harmas !== b.harmas ? '\nFIGYELEM: ' + b.harmas + ' hármas pár kellene, ' + st.harmas + ' van megadva.' : '';
      if (!confirm('START: a csapatok zárolva lesznek, és elkészülnek a pár-kódok.' + figy + '\nMehet?')) return;
      vazKuld().then(function () { return kuld({ action: 'start', pin: A.pin, menetrend: MENETREND[String(b.csapat)] }); })
        .then(function () { A.nezet = 'vezerlo'; A.uzenet = { tipus: 'ok', szoveg: 'A verseny elindult. Oszd ki a QR-kódokat, majd indítsd az 1. kört.' }; return lekeres(); });
    }
  };

  $app.addEventListener('click', function (e) {
    var el = e.target.closest('[data-akcio]');
    if (!el || el.disabled) return;
    var fn = AKCIO[el.getAttribute('data-akcio')];
    if (!fn) return;
    e.preventDefault();
    fn(el.dataset);
    render(true);
  });
  $app.addEventListener('input', function (e) {
    var el = e.target;
    if (el.dataset.vaz) vazBeir(el.dataset.vaz, el.value);
    else if (el.dataset.szam && A.urlap) {
      var n = parseInt(el.value, 10);
      A.urlap.adat[el.dataset.szam] = isNaN(n) ? -1 : n;
    }
  });
  $app.addEventListener('change', function (e) {
    // számmező elhagyásakor újrarajzolunk (pl. "Kiszálltunk" gomb állapota)
    if (e.target.dataset.szam) render(true);
  });

  // ---- Indulás ----
  (function () {
    var q = new URLSearchParams(location.search);
    var k = q.get('k');
    if (k) { A.kod = k.trim().toUpperCase(); tarIr('kupa_kod', A.kod); }
    if (q.has('admin') && !A.pin) A.pinKell = true;
    if (k || q.has('admin')) history.replaceState(null, '', location.pathname);
    if (A.pin) {
      kuld({ action: 'pin', pin: A.pin }).then(function () { A.admin = true; A.nezet = 'vezerlo'; render(true); })
        .catch(function () { A.pin = ''; tarIr('kupa_pin', ''); A.uzenet = null; });
    }
  })();
  lekeres();
  setInterval(tick, 250);
  var utolsoLekeres = 0;
  setInterval(function () {
    var kell = document.hidden ? HATTER_FRISSITES_MS : FRISSITES_MS;
    if (Date.now() - utolsoLekeres >= kell && !A.kuld) { utolsoLekeres = Date.now(); lekeres(); }
  }, 1000);
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { lekeres(); if (A.hang && !A.wakeLock) ebrenTart(); }
  });
})();
