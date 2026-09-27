/* ==========================================================================
   SecondBarrel — detail.js
   Underside pr. våben (vaaben.html?id=<detail_id>). Henter details/<id>.json
   (PLAN_v2.md trin 4) og renderer galleri, beskrivelse og kilde-knap. Ingen
   data opfindes her - mangler beskrivelsen eller billederne, udelades de
   sektioner i stedet for at vise noget opdigtet.
   ========================================================================== */
(function () {
  "use strict";

  var THEME_KEY = "vaabenoversigt:theme";
  var MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  var PIN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 22s7-7 7-12a7 7 0 1 0-14 0c0 5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>';

  var els = {
    skeleton: document.getElementById("detailSkeleton"),
    detail: document.getElementById("detail"),
    notFound: document.getElementById("notFound"),
    loadError: document.getElementById("loadError"),
    themeToggle: document.getElementById("themeToggle")
  };

  function fmtInt(n) { return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, "."); }
  function fmtPrice(n) { return fmtInt(n) + " kr."; }
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

  // -------------------------------------------------------------- galleri
  var galleryImages = [];
  var galleryIdx = 0;

  function ghostText(it) {
    if (it.calibers && it.calibers.length) {
      return it.calibers[0].replace(" Win", "").replace(" Rem", "").replace(" HMR", "").replace(" LR", "");
    }
    return it.weapon_type;
  }

  function setMainImage(idx) {
    galleryIdx = idx;
    var main = document.getElementById("galleryMain");
    if (!main) return;
    var img = galleryImages[idx];
    main.querySelector("img").src = img.full || img.thumb;
    // .gallery-thumbs er en SOESKENDE til #galleryMain, ikke et barn af det -
    // soeg derfor fra document, ligesom wireGallery() goer ved klik-lytterne.
    document.querySelectorAll(".gallery-thumbs button").forEach(function (b, i) {
      b.setAttribute("aria-current", i === idx ? "true" : "false");
    });
  }

  function galleryHtml(it) {
    if (!galleryImages.length) {
      return '<div class="gallery-empty"><span class="ghost">' + escapeHtml(ghostText(it)) + "</span></div>";
    }
    var first = galleryImages[0];
    var thumbs = galleryImages.map(function (img, i) {
      return '<button type="button" aria-current="' + (i === 0 ? "true" : "false") + '" data-i="' + i +
        '"><img src="' + escapeHtml(img.thumb || img.full) + '" alt="" loading="lazy"></button>';
    }).join("");
    return (
      '<div class="gallery">' +
      '<div class="gallery-main" id="galleryMain" tabindex="0" role="group" aria-label="Billedgalleri, brug piletaster">' +
      '<img src="' + escapeHtml(first.full || first.thumb) + '" alt="' + escapeHtml(it.title) + '">' +
      (galleryImages.length > 1
        ? '<button type="button" class="gallery-nav prev" aria-label="Forrige billede">&larr;</button>' +
          '<button type="button" class="gallery-nav next" aria-label="Næste billede">&rarr;</button>'
        : "") +
      "</div>" +
      (galleryImages.length > 1 ? '<div class="gallery-thumbs">' + thumbs + "</div>" : "") +
      "</div>"
    );
  }

  function wireGallery() {
    if (galleryImages.length < 2) return;
    var main = document.getElementById("galleryMain");
    main.addEventListener("keydown", function (e) {
      if (e.key === "ArrowRight") { setMainImage((galleryIdx + 1) % galleryImages.length); }
      if (e.key === "ArrowLeft") { setMainImage((galleryIdx - 1 + galleryImages.length) % galleryImages.length); }
    });
    main.querySelector(".prev").addEventListener("click", function () {
      setMainImage((galleryIdx - 1 + galleryImages.length) % galleryImages.length);
    });
    main.querySelector(".next").addEventListener("click", function () {
      setMainImage((galleryIdx + 1) % galleryImages.length);
    });
    document.querySelectorAll(".gallery-thumbs button").forEach(function (b) {
      b.addEventListener("click", function () { setMainImage(Number(b.dataset.i)); });
    });
  }

  // --------------------------------------------------------------- render
  function render(it) {
    document.title = "SecondBarrel – " + it.title + " – " + fmtPrice(it.price_dkk);
    galleryImages = (it.images || []).filter(function (img) { return img.full || img.thumb; });

    var sellerLabel = it.is_dealer ? "Forhandler" : "Privat";
    var dateText = it.listed_date ? "Oprettet " + formatDaDate(it.listed_date) : "";

    var tags = '<span class="tag">' + escapeHtml(it.weapon_type) + "</span>";
    (it.calibers || []).forEach(function (c) { tags += '<span class="tag">' + escapeHtml(c) + "</span>"; });
    if (it.brand) tags += '<span class="tag">' + escapeHtml(it.brand) + "</span>";
    if (it.stand_gg) tags += '<span class="tag neutral">' + escapeHtml(it.stand_gg) + "</span>";

    var loc = "";
    if (!it.is_dealer && it.postnummer && it.by) {
      loc = '<div class="loc">' + PIN_SVG + escapeHtml(it.postnummer) + " " + escapeHtml(it.by) + "</div>";
    }

    var descSection = it.description
      ? '<section class="detail-desc"><h2>Sælgers beskrivelse</h2>' +
        '<blockquote>' + escapeHtml(it.description).replace(/\n+/g, "</p><p>").replace(/^/, "<p>").replace(/$/, "</p>") +
        '<cite>— ' + escapeHtml(it.source_label) + "</cite></blockquote></section>"
      : "";

    var favBtn = window.WeaponCard ? window.WeaponCard.favButtonHtml(it.detail_id) : "";

    els.detail.innerHTML =
      '<div class="detail-seller"><span class="who"><b>' + escapeHtml(sellerLabel) + "</b> · " + escapeHtml(it.source_label) + "</span>" +
      (dateText ? '<span class="when">' + escapeHtml(dateText) + "</span>" : "") +
      favBtn +
      "</div>" +
      galleryHtml(it) +
      '<div class="detail-body">' +
      '<h1 class="detail-title">' + escapeHtml(it.title) + "</h1>" +
      '<div class="detail-price">' + fmtPrice(it.price_dkk) + "</div>" +
      '<div class="tags">' + tags + "</div>" +
      loc +
      "</div>" +
      descSection +
      '<div class="detail-cta">' +
      '<a class="btn primary" href="' + escapeHtml(it.url) + '" target="_blank" rel="noopener">Se annoncen hos ' + escapeHtml(it.source_label) + "</a>" +
      "</div>";

    els.skeleton.hidden = true;
    els.detail.hidden = false;
    wireGallery();
  }

  function showNotFound() {
    els.skeleton.hidden = true;
    els.notFound.hidden = false;
  }
  function showLoadError() {
    els.skeleton.hidden = true;
    els.loadError.hidden = false;
  }

  wireTheme();
  if (window.WeaponCard) {
    window.WeaponCard.wireFavClicks(els.detail);
    window.addEventListener("auth:favorites-changed", function () {
      var btn = els.detail.querySelector(".fav-btn");
      if (!btn || !window.Auth) return;
      btn.setAttribute("aria-pressed", String(window.Auth.isFavorite(btn.dataset.id)));
    });
  }

  // Underside-URL'en er nu /vaaben/<id>.html (PLAN: SEO/AI-soegning, 20. sep.
  // 2026) - id'et sidder i selve stien, ikke i et "?id="-query-param laengere.
  // Query-param-varianten laeses stadig, hvis den skulle dukke op et sted
  // (fx et gammelt bogmaerke), rent forsigtighedsprincip.
  var params = new URLSearchParams(window.location.search);
  var id = params.get("id");
  if (!id) {
    var pathMatch = window.location.pathname.match(/([0-9a-f]{16})\.html$/);
    if (pathMatch) id = pathMatch[1];
  }
  if (!id || !/^[0-9a-f]{16}$/.test(id)) {
    showNotFound();
  } else {
    fetch("/details/" + id + ".json")
      .then(function (r) {
        if (r.status === 404) { showNotFound(); return null; }
        if (!r.ok) throw new Error("HTTP " + r.status);
        return r.json();
      })
      .then(function (it) { if (it) render(it); })
      .catch(function (err) {
        console.error("Kunne ikke hente detaljedata", err);
        showLoadError();
      });
  }
})();
