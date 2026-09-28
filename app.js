/* ==========================================================================
   SecondBarrel — app.js
   Henter site/data.json (2.142 rigtige våben) og driver filterbjælke,
   prisskyder, sortering og kortliste. Ingen data er opdigtet her —
   alle tal (mærker, kalibre, median, histogram) beregnes fra det,
   der rent faktisk står i data.json, ved indlæsning.
   ========================================================================== */
(function () {
  "use strict";

  var DATA_URL = "data.json";
  var POSTNUMRE_URL = "postnumre.json";
  var EARTH_RADIUS_KM = 6371;
  var PAGE_SIZE = 60;
  var PRICE_CAP = 100000; // se opgavebeskrivelsen: skyderen stopper her, ikke ved den opdigtede maks-pris
  var PRICE_CAP_LABEL = "100.000 kr. og derover";
  var HIST_BINS = 20; // + 1 "og derover"-bjælke = 21, som i brandbook.html
  var BIN_WIDTH = PRICE_CAP / HIST_BINS;
  var MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  var THEME_KEY = "vaabenoversigt:theme";
  var FILTER_STORAGE_KEY = "vaabenoversigt:filters";
  // Haglkalibre, der skal staa samlet oeverst i kaliberlisten, naar Haglgevaer
  // er valgt (PLAN_v2.md trin 5) - resten sorteres efter antal som hidtil.
  var SHOTGUN_CALIBERS = ["12/70", "12/76", "16/70", "20/76", "20/70", "12/89", ".410"];
  var TYPE_PLURAL = {
    "Jagtriffel": "jagtrifler", "Haglgevær": "haglgeværer",
    "Kombinationsvåben": "kombinationsvåben", "Salonriffel": "salonrifler", "Pistol": "pistoler",
    "Revolver": "revolvere"
  };
  // Alt er valgt som udgangspunkt (19. sep. 2026) - chips fjerner fra
  // resultatet i stedet for at vælge ét ad gangen. Rækkefølgen her styrer
  // ikke visning (den kommer fra HTML'en), kun hvad "alt" betyder.
  var ALL_TYPES = ["Jagtriffel", "Haglgevær", "Kombinationsvåben", "Salonriffel", "Pistol", "Revolver"];
  var ALL_SELLERS = [true, false]; // true = Forhandler, false = Privat

  var reduceMotionQuery = window.matchMedia ? window.matchMedia("(prefers-reduced-motion: reduce)") : null;
  var reduceMotion = !!(reduceMotionQuery && reduceMotionQuery.matches);
  if (reduceMotionQuery && reduceMotionQuery.addEventListener) {
    reduceMotionQuery.addEventListener("change", function (e) { reduceMotion = e.matches; });
  }

  // ---------------------------------------------------------------- DOM ----
  var els = {
    bar: document.getElementById("filterBar"),
    resetBtn: document.getElementById("resetBtn"),
    brandSelect: document.getElementById("brandSelect"),
    caliberSelect: document.getElementById("caliberSelect"),
    searchInput: document.getElementById("searchInput"),
    hist: document.getElementById("hist"),
    maxPrice: document.getElementById("maxPrice"),
    maxPriceOut: document.getElementById("maxPriceOut"),
    medianNote: document.getElementById("medianNote"),
    resultCount: document.getElementById("resultCount"),
    resultCountLive: document.getElementById("resultCountLive"),
    resultLabel: document.getElementById("resultLabel"),
    sortSelect: document.getElementById("sortSelect"),
    cards: document.getElementById("cards"),
    skeletonCards: document.getElementById("skeletonCards"),
    emptyState: document.getElementById("emptyState"),
    loadError: document.getElementById("loadError"),
    loadMoreBtn: document.getElementById("loadMoreBtn"),
    totalTag: document.getElementById("totalTag"),
    dataDate: document.getElementById("dataDate"),
    themeToggle: document.getElementById("themeToggle"),
    autoClearNote: document.getElementById("autoClearNote"),
    postnrInput: document.getElementById("postnrInput"),
    radiusSelect: document.getElementById("radiusSelect"),
    postnrNote: document.getElementById("postnrNote"),
    distanceOption: document.getElementById("distanceOption"),
    filters: document.getElementById("filters"),
    filtersHome: document.getElementById("filtersHome"),
    miniBar: document.getElementById("miniBar"),
    miniCount: document.getElementById("miniCount"),
    miniSummary: document.getElementById("miniSummary"),
    miniFilterBtn: document.getElementById("miniFilterBtn"),
    inlineFilterBtn: document.getElementById("inlineFilterBtn"),
    inlineSummary: document.getElementById("inlineSummary"),
    sheetBackdrop: document.getElementById("sheetBackdrop"),
    sheetBody: document.getElementById("sheetBody"),
    sheetClose: document.getElementById("sheetClose"),
    sheetDone: document.getElementById("sheetDone"),
    sheetCount: document.getElementById("sheetCount")
  };

  // -------------------------------------------------------------- state ----
  var items = [];
  var visibleCount = PAGE_SIZE;
  var lastCount = 0;
  var overallMedian = 0;
  var postnumreTable = null;   // postnummer -> [lat, lon], hentet fra postnumre.json (kan mangle)
  var originCoord = null;      // {lat, lon} for state.postnr, naar det er et kendt postnummer

  var state = {
    activeTypes: new Set(ALL_TYPES),     // hvilke våbentyper der er MED - alt som udgangspunkt
    activeSellers: new Set(ALL_SELLERS), // hvilke sælgertyper der er MED - begge som udgangspunkt
    brand: "",
    caliber: "",
    search: "",        // normaliseret (lowercase) til sammenligning
    searchRaw: "",      // som brugeren skrev, til beskeden ved 0 resultater
    maxPrice: PRICE_CAP,
    sort: "newest",
    postnr: "",        // 4-cifret streng, brugerens eget postnummer
    radiusKm: null      // heltal (km) eller null ("Alle afstande")
  };

  // ------------------------------------------------------------- helpers --
  function fmtInt(n) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  }
  function fmtPrice(n) {
    return fmtInt(n) + " kr.";
  }
  function escapeHtml(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function formatDaDate(iso) {
    if (!iso) return "";
    var p = iso.split("-");
    var y = p[0], m = parseInt(p[1], 10), d = parseInt(p[2], 10);
    if (!y || !m || !d) return "";
    return d + ". " + MONTHS[m - 1] + ". " + y;
  }

  // ------------------------------------------------------------- afstand --
  // Haversine - storcirkelafstand i km. Bruges KUN naar begge punkter reelt
  // har koordinater (item.lat/lon fra export_data.py, origin fra brugerens
  // eget postnummer via postnumre.json) - aldrig gaettet eller interpoleret.
  function haversineKm(lat1, lon1, lat2, lon2) {
    var toRad = Math.PI / 180;
    var dLat = (lat2 - lat1) * toRad;
    var dLon = (lon2 - lon1) * toRad;
    var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }
  // Afstand fra origin til et item (bruges til visning og "Afstand"-
  // sortering), eller null hvis en af siderne mangler koordinater. Selve
  // radius-FILTERET har sin egen, separate undtagelse for forhandlere i
  // matchesBase() - den er ikke styret herfra.
  function distanceKm(it) {
    if (!originCoord || it.lat == null || it.lon == null) return null;
    return haversineKm(originCoord.lat, originCoord.lon, it.lat, it.lon);
  }

  // ------------------------------------------------------------ filtering --
  // opts kan slå én dimension fra ad gangen, så vi kan beregne "levende"
  // facet-tællere (hvor mange, hvis DETTE valg lægges til de andre filtre).
  function matchesBase(it, opts) {
    opts = opts || {};
    if (!opts.skipType && !state.activeTypes.has(it.weapon_type)) return false;
    if (!opts.skipSeller && !state.activeSellers.has(it.is_dealer)) return false;
    if (!opts.skipBrand && state.brand && it.brand !== state.brand) return false;
    if (!opts.skipCaliber && state.caliber && it.calibers.indexOf(state.caliber) === -1) return false;
    if (!opts.skipSearch && state.search) {
      var hay = (it.title || "").toLowerCase() + " " + (it.brand || "").toLowerCase();
      if (hay.indexOf(state.search) === -1) return false;
    }
    if (!opts.skipPrice && state.maxPrice < PRICE_CAP && it.price_dkk > state.maxPrice) return false;
    // Radius gaelder ALLE (Jonas' beslutning 27. sep. 2026 - foer blev
    // forhandlere altid vist, og saa virkede filtret i stykker, da de er ~3/4
    // af varerne). Forhandlere maales fra butikkens adresse; en forhandler
    // uden kendt adresse udelades, naar en radius er valgt. En privat annonce
    // uden postnummer har ingen kendt afstand og holdes som foer.
    if (!opts.skipRadius && state.radiusKm !== null && originCoord) {
      var d = distanceKm(it);
      if (d === null ? it.is_dealer : d > state.radiusKm) return false;
    }
    return true;
  }
  function filteredItems() {
    return items.filter(function (it) { return matchesBase(it, null); });
  }
  function countWhere(opts, extra) {
    var n = 0;
    for (var i = 0; i < items.length; i++) {
      if (extra(items[i]) && matchesBase(items[i], opts)) n++;
    }
    return n;
  }

  // --------------------------------------------------------------- sort ---
  function sortItems(arr) {
    var copy = arr.slice();
    if (state.sort === "price_asc") {
      copy.sort(function (a, b) { return a.price_dkk - b.price_dkk; });
    } else if (state.sort === "price_desc") {
      copy.sort(function (a, b) { return b.price_dkk - a.price_dkk; });
    } else if (state.sort === "distance" && originCoord) {
      // Infinity for varer uden koordinater (forhandlere) - de synker
      // konsekvent til bunds i stedet for at faa en opdigtet plads i midten.
      copy.sort(function (a, b) {
        var da = distanceKm(a), db = distanceKm(b);
        return (da === null ? Infinity : da) - (db === null ? Infinity : db);
      });
    } else {
      copy.sort(function (a, b) {
        // 0 (ikke -Infinity) som saentinel for manglende dato: to daetolese
        // raekker giver saa 0-0=0 (veldefineret "lige"), i stedet for
        // -Infinity - -Infinity = NaN, som Array#sort ikke garanterer noget for.
        var ta = a.listed_date ? Date.parse(a.listed_date) : 0;
        var tb = b.listed_date ? Date.parse(b.listed_date) : 0;
        return tb - ta; // nyeste først, null sidst
      });
    }
    return copy;
  }

  // ------------------------------------------------------------ count-tick
  function tickNumber(el, from, to, dur) {
    if (reduceMotion || from === to) {
      el.textContent = fmtInt(to);
      return;
    }
    var t0 = performance.now();
    function step(t) {
      var k = Math.min(1, (t - t0) / dur);
      k = 1 - Math.pow(1 - k, 3);
      el.textContent = fmtInt(Math.round(from + (to - from) * k));
      if (k < 1) requestAnimationFrame(step); else el.textContent = fmtInt(to);
    }
    requestAnimationFrame(step);
  }

  // -------------------------------------------------------- facet-tællere
  function updateFacetCounts() {
    var typeBtns = els.bar.querySelectorAll('.chip[data-key="type"]');
    typeBtns.forEach(function (btn) {
      var v = btn.dataset.v;
      var n = countWhere({ skipType: true }, function (it) { return it.weapon_type === v; });
      btn.querySelector(".n").textContent = fmtInt(n);
      // Valgt kaliber, som denne type ikke har: typen er fravalgt, indtil
      // kaliberen fjernes igen (28. sep. 2026). Brugerens eget valg i
      // state.activeTypes roeres ikke, saa det kommer tilbage uaendret.
      var unavailable = !!state.caliber && n === 0;
      btn.disabled = unavailable;
      btn.classList.toggle("unavailable", unavailable);
      btn.title = unavailable ? "Ingen " + v.toLowerCase() + " i kaliber " + state.caliber : "";
    });
    var sellerBtns = els.bar.querySelectorAll('.chip[data-key="seller"]');
    sellerBtns.forEach(function (btn) {
      var wantsDealer = btn.dataset.v === "Forhandler";
      var n = countWhere({ skipSeller: true }, function (it) { return it.is_dealer === wantsDealer; });
      btn.querySelector(".n").textContent = fmtInt(n);
    });
  }

  // ------------------------------------------------------------- historik
  function buildHistogram() {
    var bins = new Array(HIST_BINS).fill(0);
    var overflow = 0;
    items.forEach(function (it) {
      var p = it.price_dkk;
      if (p >= PRICE_CAP) { overflow++; return; }
      var idx = Math.min(HIST_BINS - 1, Math.floor(p / BIN_WIDTH));
      bins[idx]++;
    });
    return { bins: bins, overflow: overflow };
  }
  var histBars = []; // DOM-referencer, HIST_BINS+1 stk (sidste = "og derover")
  function renderHistogramShell() {
    var data = buildHistogram();
    var all = data.bins.concat([data.overflow]);
    var max = Math.max.apply(null, all) || 1;
    els.hist.innerHTML = "";
    els.hist.style.gridTemplateColumns = "repeat(" + all.length + ",1fr)";
    histBars = all.map(function (v) {
      var b = document.createElement("i");
      b.style.height = Math.max(3, Math.round((v / max) * 72)) + "px";
      els.hist.appendChild(b);
      return b;
    });
    updateHistogramHighlight();
  }
  // Akselabels udledes af PRICE_CAP/HIST_BINS, saa de ikke kan komme ud af trit
  // med selve histogrammet eller skyderen, hvis konstanterne aendres.
  function renderHistAxis() {
    var el = document.getElementById("histAxis");
    if (!el) return;
    el.innerHTML = "";
    var steps = 4; // 0, 1/4, 2/4, 3/4 af PRICE_CAP, saa "og derover"
    for (var i = 0; i < steps; i++) {
      var span = document.createElement("span");
      span.textContent = i === 0 ? "0 kr." : fmtInt(PRICE_CAP * i / steps);
      el.appendChild(span);
    }
    var last = document.createElement("span");
    last.textContent = PRICE_CAP_LABEL;
    el.appendChild(last);
  }
  function updateHistogramHighlight() {
    var cutoffIdx = state.maxPrice >= PRICE_CAP ? HIST_BINS : Math.floor(state.maxPrice / BIN_WIDTH);
    histBars.forEach(function (bar, i) {
      var isOverflow = i === HIST_BINS;
      var on = isOverflow ? state.maxPrice >= PRICE_CAP : i < cutoffIdx;
      bar.classList.toggle("in", on);
    });
  }

  // --------------------------------------------------------- tomt resultat
  function activeDimensions() {
    var dims = [];
    if (state.search) dims.push({ key: "search", label: '"' + state.searchRaw + '"', action: "fjern søgeordet", opt: "skipSearch" });
    if (state.caliber) dims.push({ key: "caliber", label: '"' + state.caliber + '"', action: "fjern kaliberfilteret", opt: "skipCaliber" });
    if (state.brand) dims.push({ key: "brand", label: '"' + state.brand + '"', action: "fjern mærket", opt: "skipBrand" });
    if (state.activeTypes.size < ALL_TYPES.length) {
      dims.push({ key: "type", label: "de fravalgte våbentyper", action: "vis alle våbentyper igen", opt: "skipType" });
    }
    if (state.activeSellers.size < ALL_SELLERS.length) {
      dims.push({ key: "seller", label: "det fravalgte sælgerfilter", action: "vis alle sælgertyper igen", opt: "skipSeller" });
    }
    if (state.maxPrice < PRICE_CAP) dims.push({ key: "price", label: "prisgrænsen på " + fmtInt(state.maxPrice) + " kr", action: "hæv prisen", opt: "skipPrice" });
    if (state.radiusKm !== null && originCoord) dims.push({ key: "radius", label: state.radiusKm + " km fra " + state.postnr, action: "fjern radius-filtret", opt: "skipRadius" });
    return dims;
  }
  function buildEmptyMessage() {
    var dims = activeDimensions();
    if (dims.length === 0) {
      return "Ingen våben matcher lige nu. Prøv at nulstille filtrene.";
    }
    dims.forEach(function (d) {
      var opts = {}; opts[d.opt] = true;
      d.countIfRemoved = countWhere(opts, function () { return true; });
    });
    var fixable = dims.filter(function (d) { return d.countIfRemoved > 0; })
      .sort(function (a, b) { return b.countIfRemoved - a.countIfRemoved; });

    if (fixable.length === 0) {
      var joined = dims.map(function (d) { return d.label; }).join(" og ");
      return "Ingen våben matcher " + joined + " samtidig. Fjern et eller flere filtre, eller nulstil.";
    }
    var lead = "Ingen våben matcher " + fixable[0].label + ". ";
    var a0 = fixable[0].action.charAt(0).toUpperCase() + fixable[0].action.slice(1);
    if (fixable.length === 1) {
      return lead + a0 + ".";
    }
    return lead + a0 + " eller " + fixable[1].action + ".";
  }

  // --------------------------------------------------------------- render
  function render() {
    // Foerst: reconcilér maerke/kaliber mod de OEVRIGE filtre, saa et
    // filter, der lige er blevet ugyldigt (fx skifte til en anden
    // vaabentype), er ryddet FOER selve listen filtreres denne omgang -
    // ellers ville resultatlinjen for et enkelt render vise et for lavt
    // (forkert) tal, indtil naeste render rettede det.
    updateDependentFilters();

    var filtered = filteredItems();
    var sorted = sortItems(filtered);
    var total = sorted.length;

    tickNumber(els.resultCount, lastCount, total, 350);
    if (total !== lastCount) {
      els.resultCountLive.textContent = fmtInt(total) + " " + els.resultLabel.textContent;
    }
    lastCount = total;
    updateMiniBar(total);
    updateMedianNote(filtered);
    updateFacetCounts();
    updateHistogramHighlight();

    if (total === 0) {
      els.cards.hidden = true;
      els.emptyState.hidden = false;
      els.emptyState.textContent = buildEmptyMessage();
      els.loadMoreBtn.hidden = true;
      return;
    }
    els.emptyState.hidden = true;
    els.cards.hidden = false;

    var toShow = sorted.slice(0, visibleCount);
    els.cards.innerHTML = "";
    var frag = document.createDocumentFragment();
    toShow.forEach(function (it) { frag.appendChild(window.WeaponCard.render(it, distanceKm)); });
    els.cards.appendChild(frag);

    els.loadMoreBtn.hidden = toShow.length >= total;
  }

  // ---------------------------------------------------------- selects fyld
  // Afhaengige filtre (PLAN_v2.md trin 5): maerke- og kaliberlisten bygges
  // kun af de vaaben, der matcher ALLE ANDRE aktive filtre (samme
  // matchesBase-princip som chip-taellerne) - vaelges Haglgevaer, indeholder
  // kaliberlisten kun kalibre, der reelt findes blandt haglgeveraer.
  function populateSelect(select, arr, allLabel) {
    var current = select.value;
    select.innerHTML = "";
    var optAll = document.createElement("option");
    optAll.value = "";
    optAll.textContent = allLabel;
    select.appendChild(optAll);
    arr.forEach(function (row) {
      var opt = document.createElement("option");
      opt.value = row.v;
      opt.textContent = row.v + " (" + fmtInt(row.n) + ")";
      select.appendChild(opt);
    });
    select.value = current; // "" hvis den forsvandt af listen
  }
  function sortByCountThenName(counts) {
    return Object.keys(counts).map(function (k) { return { v: k, n: counts[k] }; })
      .sort(function (a, b) { return b.n - a.n || a.v.localeCompare(b.v, "da"); });
  }
  function buildBrandCounts(opts) {
    var counts = {};
    items.forEach(function (it) {
      if (it.brand && matchesBase(it, opts)) counts[it.brand] = (counts[it.brand] || 0) + 1;
    });
    return counts;
  }
  function buildCaliberCounts(opts) {
    var counts = {};
    items.forEach(function (it) {
      if (!matchesBase(it, opts)) return;
      (it.calibers || []).forEach(function (c) { counts[c] = (counts[c] || 0) + 1; });
    });
    return counts;
  }
  // Kun naar Haglgevaer er valgt UDEN Jagtriffel giver det mening at samle
  // haglkalibrene oeverst - er begge (eller "alt") valgt, er der intet
  // hagl-specifikt fokus, og en almindelig taelle-sortering er mere retvisende.
  function sortCalibersForType(counts) {
    var arr = sortByCountThenName(counts);
    if (state.activeTypes.has("Haglgevær") && !state.activeTypes.has("Jagtriffel")) {
      // stabil sort (ES2019+): kun gruppen flyttes, indbyrdes taelle-raekkefoelge bevares
      arr.sort(function (a, b) {
        var ag = SHOTGUN_CALIBERS.indexOf(a.v) !== -1, bg = SHOTGUN_CALIBERS.indexOf(b.v) !== -1;
        return ag === bg ? 0 : (ag ? -1 : 1);
      });
    }
    return arr;
  }
  // Label til autoClearNote - navngiver den ENE valgte type, hvis der kun er
  // én tilbage, ellers en generisk formulering (aldrig en opdigtet liste).
  function activeTypesLabel() {
    if (state.activeTypes.size === 1) {
      return TYPE_PLURAL[Array.from(state.activeTypes)[0]] || "de valgte våben";
    }
    return "de valgte våbentyper";
  }
  // Genberegner maerke-/kaliberlisterne ud fra de netop aktive filtre, og
  // nulstiller (med en tydelig besked) et valgt maerke/kaliber, der ikke
  // laengere giver noget resultat sammen med de andre filtre.
  function updateDependentFilters() {
    var brandCounts = buildBrandCounts({ skipBrand: true });
    var msg = "";
    if (state.brand && !brandCounts[state.brand]) {
      msg = 'Mærkefilteret "' + state.brand + '" blev fjernet, fordi ingen ' +
        activeTypesLabel() + " har det.";
      state.brand = "";
    }
    var caliberCounts = buildCaliberCounts({ skipCaliber: true });
    if (state.caliber && !caliberCounts[state.caliber]) {
      msg = 'Kaliberfilteret "' + state.caliber + '" blev fjernet, fordi ingen ' +
        activeTypesLabel() + " har det.";
      state.caliber = "";
    }
    populateSelect(els.brandSelect, sortByCountThenName(brandCounts), "Alle mærker");
    populateSelect(els.caliberSelect, sortCalibersForType(caliberCounts), "Alle kalibre");
    els.brandSelect.value = state.brand;
    els.caliberSelect.value = state.caliber;
    els.autoClearNote.hidden = !msg;
    els.autoClearNote.textContent = msg;
  }

  // ---------------------------------------------------------- postnummer
  // Slaar state.postnr op i postnumre.json og opdaterer originCoord samt de
  // afhaengige kontroller (radius-select, "Afstand"-sortering, fejlbesked).
  // Kaldes ved hvert tastetryk i feltet - "ukendt postnummer" vises derfor
  // kun, naar der reelt staar 4 cifre, der ikke matcher noget rigtigt
  // postnummer (aldrig midt i indtastningen, og aldrig et gaettet resultat).
  function resolveOrigin() {
    originCoord = null;
    if (state.postnr.length === 4 && postnumreTable && postnumreTable[state.postnr]) {
      var c = postnumreTable[state.postnr];
      originCoord = { lat: c[0], lon: c[1] };
    }
    if (!originCoord) {
      state.radiusKm = null;
      els.radiusSelect.value = "";
      if (state.sort === "distance") state.sort = "newest";
    }
    els.radiusSelect.disabled = !originCoord;
    els.distanceOption.disabled = !originCoord;
    els.sortSelect.value = state.sort;
    updatePostnrNote();
  }
  // Ét sted, der afgoer, hvad der (om noget) skal staa under postnummerfeltet:
  // en fejl (ugyldigt postnummer) vinder over hint-teksten om, at forhandlere
  // altid vises uanset radius, som igen kun vises, naar en radius rent
  // faktisk er valgt.
  function updatePostnrNote() {
    var msg = "", isError = false;
    if (state.postnr.length === 4 && !originCoord) {
      msg = postnumreTable ? "Ukendt postnummer." : "Afstandsopslag er ikke tilgængeligt lige nu.";
      isError = true;
    } else if (state.radiusKm !== null && originCoord) {
      msg = "Forhandlere måles fra butikkens adresse - mange sender også til hele landet.";
    }
    els.postnrNote.hidden = !msg;
    els.postnrNote.textContent = msg;
    els.postnrNote.classList.toggle("error", isError);
  }

  // -------------------------------------------------------------- median
  function computeMedian(list) {
    var prices = (list || items).map(function (it) { return it.price_dkk; }).sort(function (a, b) { return a - b; });
    var n = prices.length;
    if (n === 0) return 0;
    return n % 2 ? prices[(n - 1) / 2] : (prices[n / 2 - 1] + prices[n / 2]) / 2;
  }

  // "i nat kl. 02:41" / "i dag kl. 14:05" / "i går kl. 02:41" / "26. sep. kl. 02:41"
  function describeUpdated(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d)) return "";
    var hhmm = ("0" + d.getHours()).slice(-2) + ":" + ("0" + d.getMinutes()).slice(-2);
    var today = new Date(); today.setHours(0, 0, 0, 0);
    var day = new Date(d); day.setHours(0, 0, 0, 0);
    var diff = Math.round((today - day) / 86400000);
    if (diff === 0) return (d.getHours() < 6 ? "i nat" : "i dag") + " kl. " + hhmm;
    if (diff === 1) return "i går kl. " + hhmm;
    return formatDaDate(String(iso).split("T")[0]) + " kl. " + hhmm;
  }

  // Medianen foelger de VISTE annoncer (28. sep. 2026 - foer var den et fast
  // tal for alle typer blandet, ved siden af et histogram, der fulgte
  // filtrene). "Udbudspris": det er saelgernes bud, ikke handelspriser.
  function updateMedianNote(list) {
    if (!els.medianNote) return;
    els.medianNote.textContent = list.length
      ? "Median udbudspris for de " + fmtInt(list.length) + " viste annoncer: " + fmtPrice(computeMedian(list)) +
        " Udbudspriser er sælgernes egne priser, ikke handelspriser."
      : "";
  }

  // --------------------------------------------------------------- events
  function resetVisible() { visibleCount = PAGE_SIZE; }

  function wireEvents() {
    // Alt er valgt som udgangspunkt - et klik fjerner/gentilfoejer KUN den
    // enkelte chip, i modsaetning til den gamle "vaelg ét ad gangen"-model.
    els.bar.addEventListener("click", function (e) {
      var btn = e.target.closest(".chip");
      if (!btn) return;
      if (btn === els.resetBtn) { doReset(); return; }
      var key = btn.dataset.key;
      if (!key) return;
      var v = key === "seller" ? (btn.dataset.v === "Forhandler") : btn.dataset.v;
      var set = key === "type" ? state.activeTypes : state.activeSellers;
      var willBeActive = !set.has(v);
      if (willBeActive) set.add(v); else set.delete(v);
      btn.setAttribute("aria-pressed", String(willBeActive));
      resetVisible();
      render();
    });

    els.brandSelect.addEventListener("change", function () {
      state.brand = els.brandSelect.value;
      resetVisible();
      render();
    });
    els.caliberSelect.addEventListener("change", function () {
      state.caliber = els.caliberSelect.value;
      resetVisible();
      render();
    });
    els.searchInput.addEventListener("input", function () {
      state.searchRaw = els.searchInput.value.trim();
      state.search = state.searchRaw.toLowerCase();
      resetVisible();
      render();
    });
    els.maxPrice.addEventListener("input", function () {
      state.maxPrice = Number(els.maxPrice.value);
      els.maxPriceOut.textContent = state.maxPrice >= PRICE_CAP ? PRICE_CAP_LABEL : "op til " + fmtPrice(state.maxPrice);
      resetVisible();
      render();
    });
    els.sortSelect.addEventListener("change", function () {
      state.sort = els.sortSelect.value;
      render(); // sortering nulstiller ikke "vis flere"
    });
    els.postnrInput.addEventListener("input", function () {
      state.postnr = els.postnrInput.value.replace(/\D/g, "").slice(0, 4);
      els.postnrInput.value = state.postnr;
      resolveOrigin();
      resetVisible();
      render();
    });
    els.radiusSelect.addEventListener("change", function () {
      state.radiusKm = els.radiusSelect.value ? Number(els.radiusSelect.value) : null;
      updatePostnrNote();
      resetVisible();
      render();
    });
    // Gem filtertilstanden, foer et kort forlader siden via foto-linket til
    // undersiden - "Tilbage til oversigten" der laeser den igen.
    els.cards.addEventListener("click", function (e) {
      if (e.target.closest("a.photo-link")) saveFilterState();
    });
    window.WeaponCard.wireFavClicks(els.cards);
    // Favoritlisten hentes asynkront fra Supabase, ofte efter foerste render -
    // gentegn kortene, naar den er klar, saa stjernerne rammer den rigtige
    // starttilstand uden at brugeren skal reloade.
    window.addEventListener("auth:favorites-changed", function () {
      if (items.length) render();
    });
    els.loadMoreBtn.addEventListener("click", function () {
      visibleCount += PAGE_SIZE;
      render();
    });
  }

  function doReset() {
    state.activeTypes = new Set(ALL_TYPES);
    state.activeSellers = new Set(ALL_SELLERS);
    state.brand = "";
    state.caliber = "";
    state.search = "";
    state.searchRaw = "";
    state.maxPrice = PRICE_CAP;
    state.postnr = "";
    state.radiusKm = null;
    els.bar.querySelectorAll('.chip[data-key="type"], .chip[data-key="seller"]')
      .forEach(function (c) { c.setAttribute("aria-pressed", "true"); });
    els.brandSelect.value = "";
    els.caliberSelect.value = "";
    els.searchInput.value = "";
    els.maxPrice.value = String(PRICE_CAP);
    els.maxPriceOut.textContent = PRICE_CAP_LABEL;
    els.postnrInput.value = "";
    resolveOrigin();
    resetVisible();
    render();
  }

  // ------------------------------------------------------- filtertilstand
  // Gemmes i sessionStorage, naar et kort klikkes til undersiden, saa
  // "Tilbage til oversigten" kan genindlaese de samme filtre OG scroll ned
  // til samme sted, i stedet for at starte forfra oppe i toppen hver gang.
  // maxPrice's min-vaerdi udledes af data ved init, saa den gemmes ikke -
  // kun selve valgene.
  var pendingScrollY = null;
  function saveFilterState() {
    try {
      // Set kan ikke JSON.stringify'es direkte (bliver til "{}") - gemmes
      // derfor som arrays, ligesom de laeses tilbage i restoreFilterState().
      var filters = {};
      Object.keys(state).forEach(function (k) {
        filters[k] = state[k] instanceof Set ? Array.from(state[k]) : state[k];
      });
      window.sessionStorage.setItem(FILTER_STORAGE_KEY, JSON.stringify({
        filters: filters,
        visibleCount: visibleCount,
        scrollY: window.scrollY
      }));
    } catch (e) { /* privat browsing e.l. */ }
  }
  function restoreFilterState() {
    var saved;
    try {
      var raw = window.sessionStorage.getItem(FILTER_STORAGE_KEY);
      saved = raw ? JSON.parse(raw) : null;
    } catch (e) { saved = null; }
    if (!saved || !saved.filters) return;
    Object.keys(state).forEach(function (k) {
      if (!(k in saved.filters)) return;
      state[k] = state[k] instanceof Set ? new Set(saved.filters[k]) : saved.filters[k];
    });
    // "Vis flere" skal genskabes FOER render(), saa der reelt er nok kort til
    // at scrolle ned til - ellers ville siden bare vaere for kort.
    if (saved.visibleCount > visibleCount) visibleCount = saved.visibleCount;
    if (typeof saved.scrollY === "number") pendingScrollY = saved.scrollY;
    syncControlsFromState();
  }
  // Stiller alle synlige kontroller (chips, selects, soegefelt, prisskyder)
  // i overensstemmelse med state - brugt naar filtre genindlaeses fra
  // sessionStorage, saa UI'et ikke stritter imod den genskabte tilstand.
  function syncControlsFromState() {
    els.bar.querySelectorAll('.chip[data-key="type"]').forEach(function (btn) {
      btn.setAttribute("aria-pressed", String(state.activeTypes.has(btn.dataset.v)));
    });
    els.bar.querySelectorAll('.chip[data-key="seller"]').forEach(function (btn) {
      btn.setAttribute("aria-pressed", String(state.activeSellers.has(btn.dataset.v === "Forhandler")));
    });
    els.searchInput.value = state.searchRaw || "";
    els.maxPrice.value = String(state.maxPrice);
    els.maxPriceOut.textContent = state.maxPrice >= PRICE_CAP ? PRICE_CAP_LABEL : "op til " + fmtPrice(state.maxPrice);
    els.sortSelect.value = state.sort;
    els.postnrInput.value = state.postnr || "";
    els.radiusSelect.value = state.radiusKm ? String(state.radiusKm) : "";
    resolveOrigin(); // slaar det genindlaeste postnummer op og retter evt. et nu ugyldigt radius/sort-valg
    // brand-/kaliberselects faar deres <option>-liste (og value) af
    // updateDependentFilters() ved naeste render() - intet at goere her.
  }

  // ------------------------------------------- kompakt bar + filterpanel
  // Mønster: "skjul ved scroll ned, vis ved scroll op" (Headroom-stil). Den
  // slanke bar viser kun antal + aktive valg; hele filtermenuen åbnes som et
  // panel ovenpå på brugerens eget initiativ, så den aldrig dækker produkterne
  // uopfordret. Selve filter-DOM'en FLYTTES ind i panelet og tilbage igen
  // (ikke klonet), så alle eksisterende event-lyttere virker uændret.
  function activeSummaryParts() {
    var parts = [];
    if (state.activeTypes.size < ALL_TYPES.length) {
      // Nævn den korteste side: "uden Jagtriffel" frem for fem inkluderede typer.
      var inc = ALL_TYPES.filter(function (t) { return state.activeTypes.has(t); });
      var exc = ALL_TYPES.filter(function (t) { return !state.activeTypes.has(t); });
      if (!inc.length) parts.push("ingen typer");
      else parts.push(exc.length < inc.length ? "uden " + exc.join(", ") : inc.join(", "));
    }
    if (state.activeSellers.size < ALL_SELLERS.length) {
      parts.push(state.activeSellers.has(true) ? "kun forhandlere" : (state.activeSellers.has(false) ? "kun private" : "ingen sælgere"));
    }
    if (state.brand) parts.push(state.brand);
    if (state.caliber) parts.push(state.caliber);
    if (state.search) parts.push("“" + state.searchRaw + "”");
    if (state.maxPrice < PRICE_CAP) parts.push("maks. " + fmtPrice(state.maxPrice));
    if (state.radiusKm !== null && originCoord) parts.push(state.radiusKm + " km fra " + state.postnr);
    return parts;
  }
  function updateMiniBar(total) {
    els.miniCount.textContent = fmtInt(total);
    els.sheetCount.textContent = fmtInt(total);
    var parts = activeSummaryParts();
    els.miniSummary.textContent = parts.length ? "· " + parts.join(" · ") : "· alle";
    if (els.inlineSummary) els.inlineSummary.textContent = (parts.length ? parts.join(" · ") : "alle") + " · " + fmtInt(total) + " annoncer";
  }

  var SCROLL_THRESHOLD = 15; // px i samme retning, før baren reagerer - undgår blinken
  var lastScrollY = 0, scrollAccum = 0, miniShown = false, scrollTicking = false;
  function setMiniBar(show) {
    if (show === miniShown) return;
    miniShown = show;
    els.miniBar.classList.toggle("show", show);
    els.miniBar.setAttribute("aria-hidden", String(!show));
    els.miniFilterBtn.tabIndex = show ? 0 : -1;
  }
  function onScroll() {
    scrollTicking = false;
    if (!els.sheetBackdrop.hidden) return;
    var y = window.scrollY;
    var homeBottom = els.filtersHome.getBoundingClientRect().bottom + y;
    var delta = y - lastScrollY;
    lastScrollY = y;
    // Mens den fulde menu stadig er synlig i toppen, er der ingen grund til baren.
    if (y < homeBottom) { scrollAccum = 0; setMiniBar(false); return; }
    // Nulstil akkumulatoren, når retningen skifter, så kun sammenhængende
    // bevægelse tæller mod tærsklen.
    if ((delta > 0 && scrollAccum < 0) || (delta < 0 && scrollAccum > 0)) scrollAccum = 0;
    scrollAccum += delta;
    if (scrollAccum <= -SCROLL_THRESHOLD) setMiniBar(true);
    else if (scrollAccum >= SCROLL_THRESHOLD) setMiniBar(false);
  }

  var sheetReturnFocus = null, sheetOpenSnapshot = "";
  function filterSnapshot() {
    return JSON.stringify([Array.from(state.activeTypes), Array.from(state.activeSellers), state.brand,
      state.caliber, state.search, state.maxPrice, state.postnr, state.radiusKm]);
  }
  function openSheet() {
    sheetReturnFocus = document.activeElement;
    sheetOpenSnapshot = filterSnapshot();
    els.sheetBody.appendChild(els.filters);
    els.sheetBackdrop.hidden = false;
    document.body.classList.add("sheet-open");
    setMiniBar(false);
    els.sheetClose.focus({ preventScroll: true });
  }
  function closeSheet() {
    if (els.sheetBackdrop.hidden) return;
    els.filtersHome.appendChild(els.filters);
    els.sheetBackdrop.hidden = true;
    document.body.classList.remove("sheet-open");
    // Ændrede valg = en ny resultatliste; stå ikke midt i den, gå til toppen af resultaterne.
    if (filterSnapshot() !== sheetOpenSnapshot) {
      var resultTop = document.querySelector(".result").getBoundingClientRect().top + window.scrollY - 64;
      window.scrollTo(0, Math.max(0, resultTop));
    }
    lastScrollY = window.scrollY;
    scrollAccum = 0;
    // Brugeren har netop brugt baren - lad den stå, indtil de scroller ned igen.
    if (window.scrollY >= els.filtersHome.getBoundingClientRect().bottom + window.scrollY) setMiniBar(true);
    if (sheetReturnFocus && sheetReturnFocus.focus) sheetReturnFocus.focus({ preventScroll: true });
  }
  function wireMiniBar() {
    lastScrollY = window.scrollY;
    window.addEventListener("scroll", function () {
      if (!scrollTicking) { scrollTicking = true; requestAnimationFrame(onScroll); }
    }, { passive: true });
    els.miniFilterBtn.addEventListener("click", openSheet);
    if (els.inlineFilterBtn) els.inlineFilterBtn.addEventListener("click", openSheet);
    els.sheetClose.addEventListener("click", closeSheet);
    els.sheetDone.addEventListener("click", closeSheet);
    els.sheetBackdrop.addEventListener("click", function (e) { if (e.target === els.sheetBackdrop) closeSheet(); });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeSheet(); });
  }

  // ----------------------------------------------------------------- tema
  function applyTheme(mode) {
    if (mode === "light" || mode === "dark") {
      document.documentElement.setAttribute("data-theme", mode);
    } else {
      document.documentElement.removeAttribute("data-theme");
      mode = "system";
    }
    var label = mode === "system" ? "Auto" : (mode === "light" ? "Lyst" : "Mørkt");
    els.themeToggle.textContent = "Tema: " + label;
    els.themeToggle.setAttribute("aria-label", "Skift tema (nu " + label.toLowerCase() + ")");
  }
  function wireTheme() {
    var saved = "system";
    try { saved = window.localStorage.getItem(THEME_KEY) || "system"; } catch (e) { /* privat browsing e.l. */ }
    applyTheme(saved);
    els.themeToggle.addEventListener("click", function () {
      var current = document.documentElement.getAttribute("data-theme") || "system";
      var next = current === "system" ? "light" : (current === "light" ? "dark" : "system");
      applyTheme(next);
      try { window.localStorage.setItem(THEME_KEY, next); } catch (e) { /* ignorer */ }
    });
  }

  // ---------------------------------------------------------------- init
  function init(payload) {
    items = (payload && payload.items) || [];

    overallMedian = computeMedian();

    // Skyderens gulv er den rigtige laveste pris i data, ikke et gaettet 0 -
    // under den vaerdi giver ethvert valg garanteret nul resultater. Sat
    // FOER restoreFilterState(), saa en genindlaest maxPrice-vaerdi ikke
    // risikerer at blive sat foer min-attributten findes.
    if (items.length) {
      var minPrice = Math.min.apply(null, items.map(function (it) { return it.price_dkk; }));
      els.maxPrice.min = String(minPrice);
    }

    restoreFilterState();
    renderHistAxis();
    renderHistogramShell();

    // Ikke "lige nu": data er et oejebliksbillede fra seneste natlige kørsel
    // (28. sep. 2026). Vis hvornaar, saa brugeren kan vurdere aktualiteten.
    var updated = describeUpdated(payload && payload.generated_at);
    if (els.totalTag) els.totalTag.textContent = " — " + fmtInt(items.length) + " annoncer" + (updated ? ", opdateret " + updated : "");
    if (els.dataDate && updated) {
      els.dataDate.textContent = " Annoncerne blev hentet " + updated + " og opdateres hver nat. En annonce kan være solgt siden.";
    }

    els.skeletonCards.hidden = true;
    els.skeletonCards.innerHTML = "";

    wireEvents();
    wireMiniBar();
    render();

    // Scroll til det sted, brugeren slap, da et kort blev aabnet - efter
    // render() har saettet DOM'et op, og i naeste frame, saa layoutet
    // (kortenes reserverede 4:3-plads) er faktisk maalt af browseren.
    if (pendingScrollY !== null) {
      var y = pendingScrollY;
      pendingScrollY = null;
      requestAnimationFrame(function () { requestAnimationFrame(function () { window.scrollTo(0, y); }); });
    }
  }

  function buildSkeleton() {
    var frag = document.createDocumentFragment();
    for (var i = 0; i < 8; i++) {
      var d = document.createElement("div");
      d.className = "skeleton-card";
      d.innerHTML =
        '<div class="photo"></div>' +
        '<div class="lines">' +
        '<span class="skeleton-line" style="width:85%"></span>' +
        '<span class="skeleton-line" style="width:40%"></span>' +
        '<span class="skeleton-line" style="width:60%"></span>' +
        "</div>";
      frag.appendChild(d);
    }
    els.skeletonCards.appendChild(frag);
  }

  wireTheme();
  buildSkeleton();

  // postnumre.json er valgfri (findes kun, hvis export_data.py fandt
  // postnumre_dk.json) - fejler den, disabler resolveOrigin() bare
  // radius-feltet i stedet for at vaelte hele siden.
  var postnumrePromise = fetch(POSTNUMRE_URL)
    .then(function (r) { return r.ok ? r.json() : null; })
    .catch(function () { return null; });

  fetch(DATA_URL)
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (payload) {
      return postnumrePromise.then(function (table) {
        postnumreTable = table;
        init(payload);
      });
    })
    .catch(function (err) {
      console.error("Kunne ikke hente " + DATA_URL, err);
      els.skeletonCards.hidden = true;
      els.loadError.hidden = false;
    });
})();
