/* =========================================================
   KARÁCSONYI KUPA – logika.js
   Tiszta számoló függvények (nincs benne képernyő, nincs hálózat).
   Böngészőben: window.Logika · Node teszthez: module.exports
   ========================================================= */
(function (gyoker) {
  'use strict';

  // ---- Állomások ----
  var ALLOMASOK = {
    BIL1:   { nev: 'Biliárd 1',    tipus: 'BIL' },
    BIL2:   { nev: 'Biliárd 2',    tipus: 'BIL' },
    DARTS:  { nev: 'Darts',        tipus: 'DARTS' },
    CSOCSO: { nev: 'Csocsó',       tipus: 'CSOCSO' },
    SHUF:   { nev: 'Shuffleboard', tipus: 'SHUF' },
    BOW1:   { nev: 'Bowling 1',    tipus: 'BOW' },
    BOW2:   { nev: 'Bowling 2',    tipus: 'BOW' }
  };
  var MIN_JATEKOS = 24, MAX_JATEKOS = 39;
  var BOWLING_MAX_PONT = 12;   // a bowling összesen ennyit ér csapatonként (= 2 normál kör)

  // ---- Létszám → csapatok ----
  // 4 fős csapatok, a maradék 1–3 ember egy-egy párt egészít ki hármasra
  function csapatBeosztas(jatekosok) {
    var n = Math.floor(Number(jatekosok) || 0);
    if (n < MIN_JATEKOS || n > MAX_JATEKOS) return null;
    return { csapat: Math.floor(n / 4), harmas: n % 4 };
  }

  function korokSzama(csapat) { return csapat <= 7 ? 7 : csapat; }

  // Teljes időkeretből a kör játékideje (perc), váltási idővel
  function jatekPercSzamol(osszIdo, csapat, valtasPerc) {
    var k = korokSzama(csapat);
    return Math.max(5, Math.floor(osszIdo / k) - valtasPerc);
  }

  // ---- Menetrend → meccslista ----
  // Pár azonosító: 2*csapat + 0 (A pár) / 1 (B pár)
  function parCsapat(p) { return Math.floor(p / 2); }

  function meccsLista(menetrend) {
    var lista = [];
    (menetrend || []).forEach(function (kor, r) {
      kor.meccsek.forEach(function (m) {
        lista.push({ id: (r + 1) + '-' + m.allomas, kor: r + 1, allomas: m.allomas, tipus: ALLOMASOK[m.allomas].tipus, a: m.a, b: m.b });
      });
      kor.bowling.forEach(function (t, i) {
        var al = 'BOW' + (i + 1);
        lista.push({ id: (r + 1) + '-' + al, kor: r + 1, allomas: al, tipus: 'BOW', csapat: t });
      });
    });
    return lista;
  }

  // A beírt oldalak kulcsa: pár = 'p5', bowling csapat = 't2', admin döntés = 'admin'
  function oldalKulcs(meccs, oldal) { return meccs + '|' + oldal; }

  // Legutolsó beírás meccsenként és oldalanként (a null adat = törölt beírás)
  function utolsoBeirasok(beirasok) {
    var t = {};
    (beirasok || []).forEach(function (b) {
      var k = oldalKulcs(b.meccs, b.oldal);
      if (!t[k] || Number(b.ido) >= Number(t[k].ido)) t[k] = b;
    });
    Object.keys(t).forEach(function (k) { if (t[k].adat == null) delete t[k]; });
    return t;
  }

  function vag(x) { return Math.max(-1, Math.min(1, x)); }
  function egeszE(v, min, max) { return typeof v === 'number' && Math.floor(v) === v && v >= min && v <= max; }

  // ---- Egy oldal adatának érvényessége ----
  function ervenyesAdat(tipus, d) {
    if (!d || typeof d !== 'object') return false;
    switch (tipus) {
      case 'CSOCSO': return egeszE(d.gol, 0, 10);
      case 'DARTS':  return egeszE(d.marad, 0, 301);
      case 'BIL':    return egeszE(d.fent, 0, 7) && ['mi', 'ellen', 'senki'].indexOf(d.nyolcas) >= 0;
      case 'SHUF':   return egeszE(d.pont, 0, 99) && typeof d.kesz === 'boolean';
      case 'BOW':    return egeszE(d.fa, 0, 300);
    }
    return false;
  }

  // ---- Két oldal adatából eredmény ----
  // vissza: { gyoztes: 'a'|'b'|'d'|null(=ütközés), folA }  (folB = -folA)
  function kiertekel(tipus, da, db) {
    switch (tipus) {
      case 'CSOCSO':
        if (da.gol === 10 && db.gol === 10) return { gyoztes: null, folA: 0 };
        return { gyoztes: da.gol === 10 ? 'a' : db.gol === 10 ? 'b' : 'd', folA: vag((da.gol - db.gol) / 10) };
      case 'DARTS':
        if (da.marad === 0 && db.marad === 0) return { gyoztes: null, folA: 0 };
        return { gyoztes: da.marad === 0 ? 'a' : db.marad === 0 ? 'b' : 'd', folA: vag((db.marad - da.marad) / 301) };
      case 'BIL':
        var fol = vag((db.fent - da.fent) / 7);
        if (da.nyolcas === 'mi' && db.nyolcas === 'ellen') return { gyoztes: 'a', folA: fol };
        if (da.nyolcas === 'ellen' && db.nyolcas === 'mi') return { gyoztes: 'b', folA: fol };
        if (da.nyolcas === 'senki' && db.nyolcas === 'senki') return { gyoztes: 'd', folA: fol };
        return { gyoztes: null, folA: 0 };
      case 'SHUF':
        if (da.kesz !== db.kesz) return { gyoztes: null, folA: 0 };
        var f = vag((da.pont - db.pont) / 15);
        if (!da.kesz) return { gyoztes: 'd', folA: f };            // lejárt az idő = döntetlen
        return { gyoztes: da.pont > db.pont ? 'a' : da.pont < db.pont ? 'b' : 'd', folA: f };
    }
    return { gyoztes: null, folA: 0 };
  }

  // ---- Egy meccs állapota ----
  // allapot: 'ures' | 'felig' | 'ok' | 'utkozes'
  function meccsAllapot(m, utolsok) {
    if (m.tipus === 'BOW') {
      var bw = utolsok[oldalKulcs(m.id, 't' + m.csapat)];
      return bw ? { allapot: 'ok', fa: bw.adat.fa } : { allapot: 'ures' };
    }
    var ea = utolsok[oldalKulcs(m.id, 'p' + m.a)];
    var eb = utolsok[oldalKulcs(m.id, 'p' + m.b)];
    var ad = utolsok[oldalKulcs(m.id, 'admin')];
    var da = ea && ervenyesAdat(m.tipus, ea.adat) ? ea.adat : null;
    var db = eb && ervenyesAdat(m.tipus, eb.adat) ? eb.adat : null;
    var szamolt = da && db ? kiertekel(m.tipus, da, db) : null;

    // Admin döntés felülír mindent
    if (ad && ['a', 'b', 'd'].indexOf(ad.adat.gyoztes) >= 0) {
      var g = ad.adat.gyoztes, folA = 0;
      if (szamolt) {
        // a fölény csak akkor marad, ha iránya egyezik a döntéssel
        var irany = g === 'a' ? 1 : g === 'b' ? -1 : 0;
        if (irany === 0 || szamolt.folA * irany > 0) folA = szamolt.folA;
      }
      return { allapot: 'ok', admin: true, gyoztes: g, folA: folA, da: da, db: db };
    }
    if (!da && !db) return { allapot: 'ures' };
    if (!da || !db) return { allapot: 'felig', da: da, db: db };
    if (szamolt.gyoztes === null) return { allapot: 'utkozes', da: da, db: db };
    return { allapot: 'ok', gyoztes: szamolt.gyoztes, folA: szamolt.folA, da: da, db: db };
  }

  // ---- Rangsor ----
  function rendez(lista) {
    return lista.sort(function (x, y) {
      return (y.pont - x.pont) || (y.gy - x.gy) || (y.fol - x.fol) || (y.buch - x.buch) || String(x.nev).localeCompare(String(y.nev), 'hu');
    });
  }
  function kerekit(x, jegy) { var h = Math.pow(10, jegy); return Math.round(x * h) / h; }

  function allasSzamol(config, beirasok) {
    var T = (config.csapatok || []).length, P = 2 * T;
    var utolsok = utolsoBeirasok(beirasok);
    var meccsek = meccsLista(config.menetrend);
    var parok = [], csapatok = [], i;
    for (i = 0; i < P; i++) {
      var cs = config.csapatok[parCsapat(i)];
      parok.push({ id: i, nev: (cs.parok[i % 2] || {}).nev || ('Pár ' + (i + 1)), csapatNev: cs.nev, pont: 0, gy: 0, d: 0, v: 0, fol: 0, buch: 0, jatszott: 0, bowPont: 0, ellenfelek: [] });
    }
    for (i = 0; i < T; i++) csapatok.push({ id: i, nev: config.csapatok[i].nev, pont: 0, gy: 0, d: 0, v: 0, fol: 0, buch: 0, jatszott: 0, bowPont: 0, ellenCsapatok: [] });

    var bowling = [];
    for (i = 0; i < T; i++) bowling.push({ csapat: i, nev: config.csapatok[i].nev, fak: [], ossz: 0, pont: 0 });
    var bowlingDb = 0;

    meccsek.forEach(function (m) {
      var a = meccsAllapot(m, utolsok);
      if (m.tipus === 'BOW') {
        if (a.allapot === 'ok') { bowling[m.csapat].fak.push(a.fa); bowling[m.csapat].ossz += a.fa; bowlingDb++; }
        return;
      }
      if (a.allapot !== 'ok') return;
      [['a', m.a, m.b, a.folA], ['b', m.b, m.a, -a.folA]].forEach(function (o) {
        var p = parok[o[1]], c = csapatok[parCsapat(o[1])];
        var pt = a.gyoztes === o[0] ? 3 : a.gyoztes === 'd' ? 1 : 0;
        [p, c].forEach(function (x) {
          x.pont += pt; x.jatszott++; x.fol += o[3];
          if (pt === 3) x.gy++; else if (pt === 1) x.d++; else x.v++;
        });
        p.ellenfelek.push(o[2]);
        c.ellenCsapatok.push(parCsapat(o[2]));
      });
    });

    // Buchholz: az ellenfelek meccspontjainak összege (bowling nélkül)
    parok.forEach(function (p) { p.buch = p.ellenfelek.reduce(function (s, q) { return s + parok[q].pont; }, 0); });
    csapatok.forEach(function (c) { c.buch = c.ellenCsapatok.reduce(function (s, u) { return s + csapatok[u].pont; }, 0); });

    // Bowling: csak ha minden csapat mindkét játéka beírva → helyezés szerinti pont
    var bowlingKesz = T > 1 && bowlingDb === 2 * T;
    if (bowlingKesz) {
      var sor = bowling.slice().sort(function (x, y) { return y.ossz - x.ossz; });
      var poz = 0;
      while (poz < sor.length) {
        var veg = poz;
        while (veg + 1 < sor.length && sor[veg + 1].ossz === sor[poz].ossz) veg++;
        var atlagHely = (poz + veg) / 2 + 1;   // holtversenyben átlagolt helyezés
        var pont = kerekit(BOWLING_MAX_PONT * (T - atlagHely) / (T - 1), 1);
        for (var j = poz; j <= veg; j++) sor[j].pont = pont;
        poz = veg + 1;
      }
      bowling.forEach(function (b) {
        csapatok[b.csapat].bowPont = b.pont;
        csapatok[b.csapat].pont = kerekit(csapatok[b.csapat].pont + b.pont, 1);
        [2 * b.csapat, 2 * b.csapat + 1].forEach(function (q) {
          parok[q].bowPont = kerekit(b.pont / 2, 2);
          parok[q].pont = kerekit(parok[q].pont + b.pont / 2, 2);
        });
      });
    }
    parok.forEach(function (p) { p.fol = kerekit(p.fol, 2); });
    csapatok.forEach(function (c) { c.fol = kerekit(c.fol, 2); });

    return {
      parok: rendez(parok),
      csapatok: rendez(csapatok),
      bowling: bowling.slice().sort(function (x, y) { return y.ossz - x.ossz; }),
      bowlingKesz: bowlingKesz,
      bowlingDb: bowlingDb
    };
  }

  // ---- Kör-óra ----
  // vissza: hátralévő ms (lehet negatív), null ha nincs futó kör
  function hatraLevo(config, most) {
    if (!config || !config.kor || config.korStart == null) return null;
    if (config.korLezarva) return 0;
    var ref = config.szunetKezd ? config.szunetKezd : most;
    return config.jatekPerc * 60000 - (ref - config.korStart);
  }

  var Logika = {
    ALLOMASOK: ALLOMASOK, MIN_JATEKOS: MIN_JATEKOS, MAX_JATEKOS: MAX_JATEKOS, BOWLING_MAX_PONT: BOWLING_MAX_PONT,
    csapatBeosztas: csapatBeosztas, korokSzama: korokSzama, jatekPercSzamol: jatekPercSzamol,
    parCsapat: parCsapat, meccsLista: meccsLista, oldalKulcs: oldalKulcs, utolsoBeirasok: utolsoBeirasok,
    ervenyesAdat: ervenyesAdat, kiertekel: kiertekel, meccsAllapot: meccsAllapot,
    allasSzamol: allasSzamol, hatraLevo: hatraLevo
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = Logika;
  else gyoker.Logika = Logika;
})(this);
