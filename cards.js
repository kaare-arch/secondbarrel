/* ==========================================================================
   SecondBarrel — cards.js
   Fælles kort-markup, brugt af både app.js (forsiden) og favoritter.js
   (favoritsiden), så de to sider ikke vedligeholder to kopier af samme
   kort-HTML. Stjerne-knappen er en sibling til de to <a>-links i kortet
   (ikke nestet i dem), så et klik på stjernen aldrig udløser navigation.
   ========================================================================== */
(function () {
  "use strict";

  var MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

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

  var PIN_SVG = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 22s7-7 7-12a7 7 0 1 0-14 0c0 5 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg>';
  var STAR_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 6.2 6.8.7-5.1 4.6 1.5 6.7L12 17.6l-6.1 3.1 1.5-6.7-5.1-4.6 6.8-.7z"/></svg>';

  function ghostText(it) {
    if (it.calibers && it.calibers.length) {
      return it.calibers[0].replace(" Win", "").replace(" Rem", "").replace(" HMR", "").replace(" LR", "");
    }
    return it.weapon_type;
  }

  function favButtonHtml(detailId) {
    var isFav = !!(window.Auth && window.Auth.isFavorite(detailId));
    return '<button type="button" class="fav-btn" data-id="' + escapeHtml(detailId) +
      '" aria-pressed="' + (isFav ? "true" : "false") + '" aria-label="Gem favorit">' + STAR_SVG + "</button>";
  }

  // distanceFn(it) -> km (number) eller null; udelades (returnerer altid
  // null), hvis siden ikke har et postnummer at regne afstand fra.
  function cardEl(it, distanceFn) {
    distanceFn = distanceFn || function () { return null; };
    var card = document.createElement("div");
    card.className = "card";

    var sellerLabel = it.is_dealer ? "Forhandler" : "Privat";
    var dateText = it.listed_date ? "Oprettet " + formatDaDate(it.listed_date) : "";

    var tags = '<span class="tag">' + escapeHtml(it.weapon_type) + "</span>";
    (it.calibers || []).forEach(function (c) { tags += '<span class="tag">' + escapeHtml(c) + "</span>"; });
    if (it.brand) tags += '<span class="tag">' + escapeHtml(it.brand) + "</span>";
    if (it.stand_gg) tags += '<span class="tag neutral">' + escapeHtml(it.stand_gg) + "</span>";

    var loc = "";
    if (it.postnummer && it.by) {
      var d = distanceFn(it);
      loc = '<div class="loc">' + PIN_SVG + escapeHtml(it.postnummer) + " " + escapeHtml(it.by) +
        (d !== null ? " · " + fmtInt(d) + " km" : "") + "</div>";
    }

    var photoHtml = it.thumb
      ? '<img src="' + escapeHtml(it.thumb) + '" loading="lazy" alt="' + escapeHtml(it.title) + '">'
      : '<span class="ghost">' + escapeHtml(ghostText(it)) + "</span>";
    if (it.image_count > 1) {
      photoHtml += '<span class="photo-count">' + fmtInt(it.image_count) + " billeder</span>";
    }

    card.innerHTML =
      // Stjernen ligger oven paa BILLEDET (ikke kortets hjoerne), ellers
      // daekkede den datoen i saelgerlinjen (28. sep. 2026). En <button> maa
      // ikke ligge inde i <a>, derfor den faelles .photo-wrap.
      '<div class="photo-wrap">' +
      '<a class="photo-link" href="/vaaben/' + encodeURIComponent(it.detail_id) + '.html">' +
      '<div class="photo">' + photoHtml + "</div>" +
      "</a>" +
      favButtonHtml(it.detail_id) +
      "</div>" +
      '<a class="body-link" href="' + escapeHtml(it.url) + '" target="_blank" rel="noopener">' +
      '<div class="seller"><span class="who"><b>' + escapeHtml(sellerLabel) + "</b> · " + escapeHtml(it.source_label) + "</span>" +
      (dateText ? '<span class="when">' + escapeHtml(dateText) + "</span>" : "") +
      "</div>" +
      '<div class="body">' +
      '<div class="title">' + escapeHtml(it.title) + "</div>" +
      '<div class="price">' + fmtPrice(it.price_dkk) + "</div>" +
      '<div class="tags">' + tags + "</div>" +
      loc +
      "</div>" +
      '<span class="sr-only">Åbner annoncen hos ' + escapeHtml(it.source_label) + " i et nyt vindue</span>" +
      "</a>";
    return card;
  }

  function handleFavClick(btn) {
    if (!window.Auth) return;
    if (!window.Auth.getUser()) { window.Auth.openModal(); return; }
    var id = btn.dataset.id;
    var nowActive = btn.getAttribute("aria-pressed") !== "true";
    btn.setAttribute("aria-pressed", String(nowActive));
    window.Auth.toggleFavorite(id, nowActive);
  }
  // Delegeret klik-lytter på en container med et eller flere .fav-btn i sig -
  // knappen er ikke nestet i kortets <a>-links, saa der er ikke brug for
  // preventDefault/stopPropagation for at undgaa navigation.
  function wireFavClicks(container) {
    container.addEventListener("click", function (e) {
      var btn = e.target.closest(".fav-btn");
      if (!btn) return;
      handleFavClick(btn);
    });
  }

  window.WeaponCard = {
    render: cardEl,
    favButtonHtml: favButtonHtml,
    wireFavClicks: wireFavClicks,
    fmtInt: fmtInt,
    fmtPrice: fmtPrice,
    escapeHtml: escapeHtml,
    formatDaDate: formatDaDate
  };
})();
