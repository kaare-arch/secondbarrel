/* ==========================================================================
   SecondBarrel — favoritter.js
   Henter data.json (samme kilde som forsiden) og viser kun de våben, brugeren
   har markeret med stjernen. Kort-markuppen er den samme som forsidens
   (cards.js) - ingen data duplikeres eller opdigtes her.
   ========================================================================== */
(function () {
  "use strict";

  var THEME_KEY = "vaabenoversigt:theme";

  var els = {
    loggedOutState: document.getElementById("loggedOutState"),
    emptyState: document.getElementById("emptyState"),
    loadError: document.getElementById("loadError"),
    cards: document.getElementById("cards"),
    themeToggle: document.getElementById("themeToggle"),
    loginPromptBtn: document.getElementById("loginPromptBtn")
  };

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
  wireTheme();

  if (els.loginPromptBtn) {
    els.loginPromptBtn.addEventListener("click", function () {
      if (window.Auth) window.Auth.openModal();
    });
  }

  var items = [];
  function render() {
    els.loggedOutState.hidden = true;
    els.emptyState.hidden = true;
    els.cards.hidden = true;

    if (!window.Auth || !window.Auth.getUser()) {
      els.loggedOutState.hidden = false;
      return;
    }
    var favIds = new Set(window.Auth.getFavoriteIds());
    var favItems = items.filter(function (it) { return favIds.has(it.detail_id); });
    if (favItems.length === 0) {
      els.emptyState.hidden = false;
      return;
    }
    els.cards.innerHTML = "";
    var frag = document.createDocumentFragment();
    favItems.forEach(function (it) { frag.appendChild(window.WeaponCard.render(it)); });
    els.cards.appendChild(frag);
    els.cards.hidden = false;
  }

  window.WeaponCard.wireFavClicks(els.cards);
  window.addEventListener("auth:changed", render);
  window.addEventListener("auth:favorites-changed", render);

  fetch("data.json")
    .then(function (r) {
      if (!r.ok) throw new Error("HTTP " + r.status);
      return r.json();
    })
    .then(function (payload) {
      items = (payload && payload.items) || [];
      if (window.Auth) window.Auth.ready.then(render);
    })
    .catch(function (err) {
      console.error("Kunne ikke hente data.json", err);
      els.loadError.hidden = false;
    });
})();
