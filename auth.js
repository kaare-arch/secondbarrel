/* ==========================================================================
   SecondBarrel — auth.js
   Supabase Auth (login/opret bruger) + favorit-lagring. Selvstændigt modul:
   monterer selv header-knappen (#authControl) og login/opret-modalen, og
   udstiller et lille globalt window.Auth-API, som cards.js/app.js/
   favoritter.js bruger til stjerne-knappen og "Mine favoritter".
   ========================================================================== */
(function () {
  "use strict";

  if (!window.supabase || !window.SUPABASE_URL || !window.SUPABASE_ANON_KEY) {
    console.error("Supabase er ikke konfigureret (mangler supabase-js eller supabase-config.js).");
    return;
  }
  var sb = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY);

  var currentUser = null;
  var favoriteIds = new Set();
  var readyResolve;
  var ready = new Promise(function (res) { readyResolve = res; });

  function dispatch(name) { window.dispatchEvent(new Event(name)); }

  // ------------------------------------------------------------- toast ----
  function toast(msg, isError) {
    var el = document.createElement("div");
    el.className = "toast" + (isError ? " toast-error" : "");
    el.textContent = msg;
    document.body.appendChild(el);
    requestAnimationFrame(function () { el.classList.add("show"); });
    setTimeout(function () {
      el.classList.remove("show");
      setTimeout(function () { el.remove(); }, 250);
    }, 3200);
  }

  // ---------------------------------------------------------- favoritter --
  function refreshFavorites() {
    if (!currentUser) { favoriteIds = new Set(); dispatch("auth:favorites-changed"); return Promise.resolve(); }
    return sb.from("favorites").select("detail_id").eq("user_id", currentUser.id)
      .then(function (res) {
        if (res.error) { console.error(res.error); return; }
        favoriteIds = new Set((res.data || []).map(function (r) { return r.detail_id; }));
        dispatch("auth:favorites-changed");
      });
  }

  function toggleFavorite(detailId, shouldBeActive) {
    if (!currentUser) { openModal(); return Promise.resolve(false); }
    if (shouldBeActive) favoriteIds.add(detailId); else favoriteIds.delete(detailId);
    dispatch("auth:favorites-changed");
    var op = shouldBeActive
      ? sb.from("favorites").insert({ user_id: currentUser.id, detail_id: detailId })
      : sb.from("favorites").delete().eq("user_id", currentUser.id).eq("detail_id", detailId);
    return op.then(function (res) {
      if (res.error) {
        if (shouldBeActive) favoriteIds.delete(detailId); else favoriteIds.add(detailId);
        dispatch("auth:favorites-changed");
        toast("Kunne ikke gemme favorit. Prøv igen.", true);
        return false;
      }
      return true;
    });
  }

  // -------------------------------------------------------------- header --
  function renderHeaderControl() {
    var mount = document.getElementById("authControl");
    if (!mount) return;
    mount.innerHTML = "";
    if (currentUser) {
      var email = document.createElement("span");
      email.className = "auth-email muted"; email.textContent = currentUser.email;
      var fav = document.createElement("a");
      fav.className = "btn"; fav.href = "favoritter.html"; fav.textContent = "Mine favoritter";
      var out = document.createElement("button");
      out.type = "button"; out.className = "btn"; out.textContent = "Log ud";
      out.addEventListener("click", function () { sb.auth.signOut(); });
      mount.appendChild(email); mount.appendChild(fav); mount.appendChild(out);
    } else {
      var inBtn = document.createElement("button");
      inBtn.type = "button"; inBtn.className = "btn"; inBtn.textContent = "Log ind";
      inBtn.addEventListener("click", function () { openModal(); });
      mount.appendChild(inBtn);
    }
  }

  // --------------------------------------------------------------- modal --
  var modalEl = null;
  function buildModal() {
    modalEl = document.createElement("div");
    modalEl.className = "auth-modal-backdrop";
    modalEl.hidden = true;
    modalEl.innerHTML =
      '<div class="auth-modal" role="dialog" aria-modal="true" aria-labelledby="authModalTitle">' +
      '<button type="button" class="auth-modal-close" aria-label="Luk">&times;</button>' +
      '<div class="auth-tabs">' +
      '<button type="button" class="auth-tab active" data-tab="signin">Log ind</button>' +
      '<button type="button" class="auth-tab" data-tab="signup">Opret bruger</button>' +
      "</div>" +
      '<h2 id="authModalTitle" class="sr-only">Log ind eller opret bruger</h2>' +
      '<form class="auth-form" data-mode="signin">' +
      '<div class="field"><label for="authEmail">E-mail</label><input type="email" id="authEmail" autocomplete="email" required></div>' +
      '<div class="field"><label for="authPassword">Adgangskode</label><input type="password" id="authPassword" autocomplete="current-password" minlength="6" required></div>' +
      '<p class="auth-forgot small"><button type="button" class="link-btn auth-forgot-btn">Glemt adgangskode?</button></p>' +
      '<p class="auth-msg" hidden></p>' +
      '<button type="submit" class="btn primary auth-submit">Log ind</button>' +
      '<p class="muted small" style="margin:12px 0 0">Vi gemmer kun din e-mail og dine favoritter. <a href="/om.html#privatliv">Læs om privatliv</a></p>' +
      "</form>" +
      "</div>";
    document.body.appendChild(modalEl);

    modalEl.addEventListener("click", function (e) { if (e.target === modalEl) closeModal(); });
    modalEl.querySelector(".auth-modal-close").addEventListener("click", closeModal);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !modalEl.hidden) closeModal(); });

    var tabs = modalEl.querySelectorAll(".auth-tab");
    var form = modalEl.querySelector(".auth-form");
    tabs.forEach(function (t) {
      t.addEventListener("click", function () {
        tabs.forEach(function (o) { o.classList.toggle("active", o === t); });
        form.dataset.mode = t.dataset.tab;
        form.querySelector(".auth-submit").textContent = t.dataset.tab === "signup" ? "Opret bruger" : "Log ind";
        form.querySelector(".auth-forgot").hidden = t.dataset.tab === "signup";
        setMsg("");
      });
    });

    // Glemt adgangskode: Supabase sender et link til /nulstil.html, hvor den
    // nye kode vaelges (28. sep. 2026). Samme svar uanset om e-mailen findes,
    // saa siden ikke afsloerer, hvem der har en konto. Kraever at
    // https://secondbarrel.com/nulstil.html staar under Redirect URLs i Supabase.
    form.querySelector(".auth-forgot-btn").addEventListener("click", function () {
      var emailEl = form.querySelector("#authEmail");
      var email = emailEl.value.trim();
      if (!email || !emailEl.checkValidity()) {
        setMsg("Skriv din e-mail ovenfor, og tryk så på “Glemt adgangskode?” igen.", true);
        emailEl.focus();
        return;
      }
      var btn = this;
      btn.disabled = true;
      sb.auth.resetPasswordForEmail(email, { redirectTo: window.location.origin + "/nulstil.html" })
        .then(function (res) {
          btn.disabled = false;
          if (res.error && /rate limit|too many/i.test(res.error.message || "")) {
            setMsg("Der er sendt for mange links på kort tid. Vent lidt, og prøv igen.", true);
            return;
          }
          setMsg("Hvis " + email + " har en konto, har vi sendt et link til at vælge en ny adgangskode. Tjek også spam.", false);
        });
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var email = form.querySelector("#authEmail").value.trim();
      var password = form.querySelector("#authPassword").value;
      var mode = form.dataset.mode;
      setMsg("");
      var submitBtn = form.querySelector(".auth-submit");
      submitBtn.disabled = true;
      var op = mode === "signup"
        ? sb.auth.signUp({ email: email, password: password })
        : sb.auth.signInWithPassword({ email: email, password: password });
      op.then(function (res) {
        submitBtn.disabled = false;
        if (res.error) { setMsg(danishAuthError(res.error), true); return; }
        if (mode === "signup" && res.data && res.data.user && !res.data.session) {
          setMsg("Tjek din e-mail for at bekræfte din konto, og log derefter ind.", false);
          return;
        }
        closeModal();
        toast("Logget ind.");
      });
    });
  }
  function setMsg(text, isError) {
    var p = modalEl.querySelector(".auth-msg");
    p.textContent = text; p.hidden = !text;
    p.classList.toggle("error", !!isError);
  }
  function danishAuthError(err) {
    var m = (err && err.message) || "";
    if (/already registered/i.test(m)) return "Den e-mail er allerede oprettet. Prøv at logge ind i stedet.";
    if (/invalid login credentials/i.test(m)) return "Forkert e-mail eller adgangskode.";
    if (/password/i.test(m) && /least/i.test(m)) return "Adgangskoden skal være mindst 6 tegn.";
    return m || "Der gik noget galt. Prøv igen.";
  }
  function openModal() {
    if (!modalEl) buildModal();
    modalEl.hidden = false;
    setMsg("");
    modalEl.querySelector(".auth-form").reset();
    // preventScroll: uden den kan browseren finde paa at scrolle siden ned
    // mod feltet, hvis fokus saettes i samme tick som modalen bliver synlig
    // (layoutet for den lige-usynliggjorte modal er ikke naadvendigvis
    // beregnet endnu) - modalen er position:fixed og skal ALDRIG flytte
    // scroll-positionen, uanset hvor langt nede paa siden brugeren er.
    modalEl.querySelector("#authEmail").focus({ preventScroll: true });
  }
  function closeModal() { if (modalEl) modalEl.hidden = true; }

  // --------------------------------------------------------------- init ---
  sb.auth.getSession().then(function (res) {
    currentUser = res.data && res.data.session ? res.data.session.user : null;
    renderHeaderControl();
    refreshFavorites().then(function () { readyResolve(); dispatch("auth:changed"); });
  });
  sb.auth.onAuthStateChange(function (_event, session) {
    currentUser = session ? session.user : null;
    renderHeaderControl();
    refreshFavorites();
    dispatch("auth:changed");
  });

  window.Auth = {
    ready: ready,
    getUser: function () { return currentUser; },
    isFavorite: function (id) { return favoriteIds.has(id); },
    getFavoriteIds: function () { return Array.from(favoriteIds); },
    toggleFavorite: toggleFavorite,
    openModal: openModal
  };
})();
