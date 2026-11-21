/*!
 * HARMONIZER landing payment widget.
 * Embed: <script src="https://zamkovoi.yoga/hz/widget.js" data-id="WIDGET_ID" data-lang="auto" data-api="https://zamkovoi.yoga/hz" async></script>
 *   data-lang: ru | en | de | fr | it | es | pt | nl | auto (browser language; widget main language if no translation).
 *   data-api: base URL of the widget API (origin, optionally with a path prefix).
 *     Legacy embeds without data-api use the script's own origin.
 * The config is fetched from data-api first; if that path fails the script
 * retries independent fallbacks (Supabase edge proxy, direct Vercel) so a
 * REG.RU → Vercel hiccup does not leave the landing page without a form.
 * Each <script> renders its own independent form right where it stands.
 * After YooKassa, the return URL has ?hz_paid=<widgetId>. That load shows
 * the thank-you text and drops the parameter, so a refresh shows the form.
 * An unpaid return has ?hz_unpaid=<widgetId>: the form is shown with a notice.
 */
(function () {
  "use strict";

  var LOCALES = ["ru", "en", "de", "fr", "it", "es", "pt", "nl"];
  var counter = 0;
  /** Shared by every copy of this script on the page. Not kept after reload. */
  var PAID_RETURN_SLOT = "__hzPaidReturnId";

  /**
   * Remember ?hz_paid= for this document only, then remove it from the address.
   * A later script on the same page reads the same id; a refresh does not.
   */
  function consumePaidReturn() {
    if (Object.prototype.hasOwnProperty.call(window, PAID_RETURN_SLOT)) {
      return window[PAID_RETURN_SLOT];
    }
    var id = null;
    try {
      var url = new URL(window.location.href);
      var raw = url.searchParams.get("hz_paid");
      if (raw) {
        id = raw;
        url.searchParams.delete("hz_paid");
        if (window.history && typeof window.history.replaceState === "function") {
          window.history.replaceState(window.history.state, "", url.toString());
        }
      }
    } catch (e) {
      id = null;
    }
    try {
      window[PAID_RETURN_SLOT] = id;
    } catch (e2) {
      /* this load still uses `id` */
    }
    return id;
  }

  var returnPaidId = consumePaidReturn();

  var UNPAID_RETURN_SLOT = "__hzUnpaidReturnId";

  /** Same as hz_paid, for ?hz_unpaid=: the payment did not go through. */
  function consumeUnpaidReturn() {
    if (Object.prototype.hasOwnProperty.call(window, UNPAID_RETURN_SLOT)) {
      return window[UNPAID_RETURN_SLOT];
    }
    var id = null;
    try {
      var url = new URL(window.location.href);
      var raw = url.searchParams.get("hz_unpaid");
      if (raw) {
        id = raw;
        url.searchParams.delete("hz_unpaid");
        if (window.history && typeof window.history.replaceState === "function") {
          window.history.replaceState(window.history.state, "", url.toString());
        }
      }
    } catch (e) {
      id = null;
    }
    try {
      window[UNPAID_RETURN_SLOT] = id;
    } catch (e2) {
      /* this load still uses `id` */
    }
    return id;
  }

  var returnUnpaidId = consumeUnpaidReturn();

  /**
   * Independent fallback API bases, tried after data-api (or the script origin):
   * 1) Supabase edge function — a second path that does not depend on the
   *    REG.RU shared-hosting proxy or its throttled RU → Vercel leg;
   * 2) direct Vercel — works everywhere except networks that block Vercel.
   */
  var FALLBACK_API_BASES = [
    "https://vsdmphhczmcgfrvbwodp.supabase.co/functions/v1/hz-proxy",
    "https://harmonizer-ten.vercel.app",
  ];

  /** Per-origin timeouts and the background retry cadence for the config. */
  var CONFIG_TIMEOUT_MS = 8000;
  var CHECKOUT_TIMEOUT_MS = 25000;
  var LOAD_RETRY_MS = 20000;

  /** Plate text when no API base answered at all (config unreachable). Eight locales. */
  var LOAD_FAIL_TEXTS = {
    ru: "Форма оплаты временно не загрузилась. Мы продолжаем пробовать — обновите страницу через минуту или напишите на sergei@zamkovoi.yoga",
    en: "The payment form has not loaded yet. We keep retrying — refresh the page in a minute or email sergei@zamkovoi.yoga",
    de: "Das Zahlungsformular konnte noch nicht geladen werden. Wir versuchen es weiter — aktualisieren Sie die Seite in einer Minute oder schreiben Sie an sergei@zamkovoi.yoga",
    fr: "Le formulaire de paiement n'a pas pu se charger. Nous réessayons — actualisez la page dans une minute ou écrivez à sergei@zamkovoi.yoga",
    it: "Il modulo di pagamento non si è caricato. Continuiamo a provare — aggiorna la pagina tra un minuto o scrivi a sergei@zamkovoi.yoga",
    es: "El formulario de pago no se ha cargado. Seguimos intentándolo — actualiza la página en un minuto o escribe a sergei@zamkovoi.yoga",
    pt: "O formulário de pagamento não carregou. Continuamos a tentar — atualize a página dentro de um minuto ou escreva para sergei@zamkovoi.yoga",
    nl: "Het betaalformulier is nog niet geladen. We blijven het proberen — vernieuw de pagina over een minuut of schrijf naar sergei@zamkovoi.yoga",
  };

  var LOAD_FAIL_CSS = [
    ":host{display:block;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;}",
    ".hz-loadfail{background:#fff7ed;color:#9a3412;border:1px solid #fdba74;border-radius:10px;",
    "padding:12px 14px;font-size:15px;line-height:1.45;text-align:left;}",
  ].join("");


  function pickLocale(dataLang) {
    var raw = String(dataLang || "").trim().toLowerCase();
    if (raw && raw !== "auto") {
      var s = raw.slice(0, 2);
      return LOCALES.indexOf(s) >= 0 ? s : "";
    }
    var langs = (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language || ""]);
    for (var i = 0; i < langs.length; i++) {
      var short = String(langs[i] || "").trim().toLowerCase().slice(0, 2);
      if (LOCALES.indexOf(short) >= 0) return short;
    }
    return "";
  }

  function timeZone() {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    } catch (e) {
      return "";
    }
  }

  function formatPrice(price, locale) {
    if (!price) return "";
    var whole = Math.round(price.amount) === price.amount;
    try {
      return new Intl.NumberFormat(locale, {
        style: "currency",
        currency: price.currency,
        minimumFractionDigits: whole ? 0 : 2,
        maximumFractionDigits: whole ? 0 : 2,
      }).format(price.amount);
    } catch (e) {
      return price.amount + " " + price.currency;
    }
  }

  function el(tag, attrs, children) {
    var node = document.createElement(tag);
    if (attrs) {
      for (var k in attrs) {
        if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
        var v = attrs[k];
        if (v == null || v === false) continue;
        if (k === "text") node.textContent = v;
        else if (k === "className") node.className = v;
        else node.setAttribute(k, v === true ? "" : v);
      }
    }
    (children || []).forEach(function (c) {
      if (c) node.appendChild(c);
    });
    return node;
  }

  function multiline(text, className) {
    var p = el("div", { className: className });
    String(text).split("\n").forEach(function (line, i) {
      if (i) p.appendChild(document.createElement("br"));
      p.appendChild(document.createTextNode(line));
    });
    return p;
  }

  function css(style) {
    var font = style.fontFamily === "inherit" ? "inherit" : style.fontFamily;
    var border = style.borderWidth > 0 ? style.borderWidth + "px solid " + style.borderColor : "none";
    return [
      ":host{display:block;font-family:" + font + ";}",
      "*{box-sizing:border-box;}",
      ".card{margin:0 auto;max-width:" + style.maxWidth + "px;background:" + style.background + ";color:" + style.textColor + ";",
      "border:" + border + ";border-radius:" + style.radius + "px;",
      "padding:" + style.paddingTop + "px " + style.paddingX + "px " + style.paddingBottom + "px;",
      "font-size:" + style.fontSize + "px;line-height:1.45;text-align:" + style.align + ";}",
      ".card>*+*{margin-top:14px;}",
      ".title{font-size:" + style.titleSize + "px;font-weight:700;line-height:1.2;margin:0;}",
      ".text,.footer{white-space:normal;}",
      ".footer{font-size:0.82em;opacity:0.75;}",
      ".methods{display:inline-flex;flex-direction:column;gap:2px;text-align:left;}",
      ".method{display:flex;align-items:center;gap:10px;padding:5px 2px;cursor:pointer;}",
      ".method.on{font-weight:600;}",
      ".method input{accent-color:" + style.accentColor + ";margin:0;width:18px;height:18px;flex:none;}",
      ".price{font-size:1.5em;font-weight:700;}",
      ".price small{font-size:0.6em;font-weight:400;opacity:.75;margin-left:6px;}",
      "input.field{display:block;width:100%;padding:12px 14px;font:inherit;color:#1f2937;background:#fff;",
      "border:1px solid rgba(127,127,127,.45);border-radius:" + style.controlRadius + "px;outline:none;}",
      "input.field:focus{border-color:" + style.accentColor + ";box-shadow:0 0 0 1px " + style.accentColor + ";}",
      "input.field.bad{border-color:#dc2626;}",
      "button.pay{display:block;width:100%;padding:14px 16px;font:inherit;font-weight:600;cursor:pointer;",
      "background:" + style.accentColor + ";color:" + style.buttonTextColor + ";border:none;border-radius:" + style.controlRadius + "px;}",
      "button.pay[disabled]{opacity:.65;cursor:default;}",
      "button.pay.busy[disabled]{opacity:.9;cursor:progress;}",
      "button.pay.busy::before{content:'';display:inline-block;width:1em;height:1em;margin-right:.55em;vertical-align:-.15em;",
      "border:2px solid currentColor;border-right-color:transparent;border-radius:50%;animation:hz-spin .7s linear infinite;}",
      "@keyframes hz-spin{to{transform:rotate(360deg);}}",
      // Own light plate: the message stays readable on any card color the author picks.
      ".err{background:#fff7ed;color:#9a3412;border:1px solid #fdba74;border-radius:" + style.controlRadius + "px;",
      "padding:10px 12px;font-size:.88em;line-height:1.4;text-align:left;}",
      ".hp{position:absolute!important;left:-10000px!important;width:1px;height:1px;overflow:hidden;}",
      ".thanks .title{margin-bottom:4px;}",
    ].join("");
  }

  /** Apple Pay is offered only where the browser says the device can pay with it. */
  function applePayAvailable() {
    try {
      return !!(window.ApplePaySession && window.ApplePaySession.canMakePayments());
    } catch (e) {
      return false;
    }
  }

  /** How long the Russian payment form may take to open before we suspect a VPN. */
  var STALL_MS = 15000;

  var ERROR_TEXT = {
    invalid_email: "errEmail",
    invalid_name: "errName",
    email_rejected: "errEmailRejected",
    already_active: "errAlreadyActive",
    unavailable: "errUnavailable",
  };

  /**
   * Render a widget into `host` from config data (shape of GET /api/widget/:id).
   * opts.preview — admin preview: no submit, no thank-you redirect logic.
   * opts.apiBases — ordered API bases for checkout (preferred first); a lone
   * opts.apiBase is accepted for compatibility and wrapped into a one-item list.
   * opts.thanks — render the thank-you state;
   * opts.unpaid — show the "payment not completed" notice above the button.
   */
  function render(host, data, opts) {
    opts = opts || {};
    var root = host.shadowRoot || host.attachShadow({ mode: "open" });
    while (root.firstChild) root.removeChild(root.firstChild);
    var t = data.texts || {};
    var style = data.style || {};
    root.appendChild(el("style", { text: css(style) }));
    var card = el("div", { className: "card", lang: data.locale || "ru" });
    root.appendChild(card);

    if (opts.thanks) {
      card.className += " thanks";
      card.appendChild(el("div", { className: "title", text: t.thanksTitle }));
      card.appendChild(multiline(t.thanksBody, "text"));
      return;
    }

    if (!data.available && !opts.preview) {
      card.appendChild(el("div", { className: "text", text: t.errUnavailable }));
      return;
    }

    var uid = "hz" + ++counter;
    var methods = data.methods || [];
    var state = { method: data.defaultMethod || methods[0] || null, via: null };
    // One row per way to pay. The international gateway also takes PayPal and,
    // for one-time products on Apple devices, Apple Pay (same price as the card).
    var options = [];
    methods.forEach(function (m) {
      if (m === "ru") {
        options.push({ method: "ru", via: null, label: t.methodRu });
        return;
      }
      options.push({ method: m, via: null, label: t.methodInt });
      if (data.kind !== "subscription" && applePayAvailable()) {
        options.push({ method: m, via: "applepay", label: "Apple Pay" });
      }
      options.push({ method: m, via: "paypal", label: "PayPal" });
    });
    if (data.paymentMode !== "choice") {
      options = options.filter(function (o) {
        return o.method === state.method;
      });
    }
    var showChoice = options.length > 1;
    var priceNode = null;
    var radioRows = [];
    var nameInput = null;
    var emailInput = el("input", {
      className: "field",
      type: "email",
      name: "email",
      autocomplete: "email",
      inputmode: "email",
      placeholder: t.emailPlaceholder,
      "aria-label": t.emailPlaceholder,
      required: true,
    });
    var button = el("button", { className: "pay", type: "submit", text: t.button });
    var errNode = el("div", { className: "err", role: "alert" });
    errNode.style.display = "none";

    function updatePrice() {
      if (!priceNode) return;
      while (priceNode.firstChild) priceNode.removeChild(priceNode.firstChild);
      var price = state.method && data.prices ? data.prices[state.method] : null;
      priceNode.appendChild(document.createTextNode(formatPrice(price, data.locale)));
      if (price && data.kind === "subscription") {
        priceNode.appendChild(el("small", { text: t.perMonth }));
      }
      radioRows.forEach(function (row) {
        var on = row.option.method === state.method && row.option.via === state.via;
        row.node.className = "method" + (on ? " on" : "");
      });
    }

    /** Creating the invoice takes several seconds: the button spins until the payment form opens. */
    var stallTimer = null;
    function setBusy(on) {
      if (stallTimer) {
        clearTimeout(stallTimer);
        stallTimer = null;
      }
      button.disabled = on;
      button.textContent = on ? t.processing : t.button;
      button.className = on ? "pay busy" : "pay";
    }

    function showError(text) {
      errNode.textContent = text || "";
      errNode.style.display = text ? "" : "none";
    }

    var elements = data.elements || [];
    elements.forEach(function (item) {
      if (!item.visible) return;
      switch (item.type) {
        case "title":
          if (t.title) card.appendChild(el("div", { className: "title", text: t.title }));
          break;
        case "text":
          if (t.text) card.appendChild(multiline(t.text, "text"));
          break;
        case "method":
          if (!showChoice) break;
          var group = el("div", { className: "methods", role: "radiogroup" });
          options.forEach(function (o, i) {
            var input = el("input", {
              type: "radio",
              name: uid + "-method",
              value: o.method + (o.via ? ":" + o.via : ""),
              checked: o.method === state.method && o.via === state.via,
            });
            input.addEventListener("change", function () {
              state.method = o.method;
              state.via = o.via;
              updatePrice();
            });
            var row = el("label", { className: "method" }, [input, el("span", { text: o.label })]);
            radioRows.push({ option: o, node: row });
            group.appendChild(row);
          });
          card.appendChild(group);
          break;
        case "price":
          priceNode = el("div", { className: "price" });
          card.appendChild(priceNode);
          break;
        case "name":
          nameInput = el("input", {
            className: "field",
            type: "text",
            name: "name",
            autocomplete: "name",
            placeholder: t.namePlaceholder,
            "aria-label": t.namePlaceholder,
          });
          card.appendChild(nameInput);
          break;
        case "email":
          card.appendChild(emailInput);
          break;
        case "button":
          card.appendChild(errNode);
          card.appendChild(button);
          break;
        case "footer":
          if (t.footer) card.appendChild(multiline(t.footer, "footer"));
          break;
      }
    });
    var honeypot = el("input", { className: "hp", type: "text", name: "website", tabindex: "-1", autocomplete: "off", "aria-hidden": "true" });
    card.appendChild(honeypot);
    updatePrice();

    function submit(ev) {
      if (ev) ev.preventDefault();
      if (opts.preview) return;
      showError("");
      var name = nameInput ? nameInput.value.trim() : "";
      var email = emailInput.value.trim();
      if (nameInput) nameInput.classList.remove("bad");
      emailInput.classList.remove("bad");
      if (nameInput && data.requireName && !name) {
        nameInput.classList.add("bad");
        showError(t.errName);
        return;
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        emailInput.classList.add("bad");
        showError(t.errEmail);
        return;
      }
      if (!state.method) {
        showError(t.errUnavailable);
        return;
      }
      setBusy(true);
      // The Russian payment form does not open through most VPNs: the browser keeps
      // waiting and this page stays. Give the buyer the button back with a hint.
      if (state.method === "ru") {
        stallTimer = setTimeout(function () {
          stallTimer = null;
          setBusy(false);
          showError(t.errVpn || t.errGeneric);
        }, STALL_MS);
      }
      // Invoice creation goes to the base that served the config first; a network
      // error or a 5xx there silently moves to the next independent base.
      var bases = (opts.apiBases && opts.apiBases.length)
        ? opts.apiBases
        : (opts.apiBase ? [opts.apiBase] : []);
      function sendCheckout(pos) {
        var base = bases[pos];
        if (!base) {
          showError(t.errGeneric);
          setBusy(false);
          return;
        }
        timedFetch(base + "/api/widget/" + encodeURIComponent(data.id) + "/checkout", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name,
            email: email,
            method: state.method,
            via: state.via || undefined,
            lang: data.locale,
            pageUrl: window.location.href,
            website: honeypot.value,
          }),
        }, CHECKOUT_TIMEOUT_MS)
          .then(function (res) {
            if (res.status >= 500 && pos + 1 < bases.length) {
              sendCheckout(pos + 1);
              return null;
            }
            return res.json().catch(function () {
              return {};
            }).then(function (out) {
              if (out && out.paymentUrl) {
                window.location.href = out.paymentUrl;
                return;
              }
              var key = (out && ERROR_TEXT[out.error]) || "errGeneric";
              if (out && out.error === "invalid_email") emailInput.classList.add("bad");
              if (out && out.error === "invalid_name" && nameInput) nameInput.classList.add("bad");
              showError(t[key] || t.errGeneric);
              setBusy(false);
            });
          })
          .catch(function () {
            if (pos + 1 < bases.length) {
              sendCheckout(pos + 1);
              return;
            }
            showError(t.errGeneric);
            setBusy(false);
          });
      }
      sendCheckout(0);
    }

    if (opts.unpaid) showError(t.errUnpaid || t.errGeneric);

    // Back from the payment form: the browser restores this page as it was left,
    // with the button still disabled. Make it usable again.
    if (typeof window.addEventListener === "function") {
      window.addEventListener("pageshow", function (ev) {
        if (!ev || !ev.persisted) return;
        setBusy(false);
      });
    }

    button.addEventListener("click", submit);
    [nameInput, emailInput].forEach(function (input) {
      if (!input) return;
      input.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") submit(ev);
      });
    });
  }

  function normalizeBase(value) {
    return String(value || "").trim().replace(/\/+$/, "");
  }

  /**
   * API bases to try, in order: data-api → script origin (legacy embeds) → fallbacks.
   * A base is an origin, optionally with a path prefix (e.g. https://site/hz).
   */
  function resolveApiBases(script) {
    var bases = [];
    function add(base) {
      if (!base) return;
      if (bases.indexOf(base) < 0) bases.push(base);
    }
    var declared = normalizeBase(script.getAttribute("data-api"));
    if (declared) {
      try {
        add(new URL(declared, window.location.href).toString().replace(/\/+$/, ""));
      } catch (e) {
        add(declared);
      }
    } else {
      try {
        add(new URL(script.src, window.location.href).origin);
      } catch (e) {
        /* no usable origin; fallbacks still apply */
      }
    }
    FALLBACK_API_BASES.forEach(add);
    return bases;
  }

  /** fetch with a per-attempt timeout; plain fetch when AbortController is missing. */
  function timedFetch(url, init, timeoutMs) {
    if (typeof AbortController !== "function") return fetch(url, init);
    var controller = new AbortController();
    var timer = setTimeout(function () {
      try {
        controller.abort();
      } catch (e) {
        /* ignore */
      }
    }, timeoutMs);
    var merged = { method: "GET" };
    if (init) {
      for (var k in init) {
        if (!Object.prototype.hasOwnProperty.call(init, k)) continue;
        merged[k] = init[k];
      }
    }
    merged.signal = controller.signal;
    return fetch(url, merged).then(
      function (res) {
        clearTimeout(timer);
        return res;
      },
      function (err) {
        clearTimeout(timer);
        throw err;
      },
    );
  }

  /**
   * GET the widget config from the first API base that answers with a payload.
   * `done(data, base)` — base is the answer that worked, null when all failed.
   */
  function loadWidgetConfig(bases, id, lang, done) {
    var index = 0;
    function attempt() {
      if (index >= bases.length) {
        done(null, null);
        return;
      }
      var base = bases[index];
      var url =
        base + "/api/widget/" + encodeURIComponent(id) +
        "?lang=" + encodeURIComponent(lang) + "&tz=" + encodeURIComponent(timeZone());
      timedFetch(url, null, CONFIG_TIMEOUT_MS)
        .then(function (res) {
          return res.ok ? res.json() : null;
        })
        .then(function (data) {
          if (data && data.texts) {
            done(data, base);
            return;
          }
          index += 1;
          attempt();
        })
        .catch(function () {
          index += 1;
          attempt();
        });
    }
    attempt();
  }

  function mount(script) {
    if (script.getAttribute("data-hz-mounted")) return;
    script.setAttribute("data-hz-mounted", "1");
    var id = (script.getAttribute("data-id") || "").trim();
    if (!id) return;
    var bases = resolveApiBases(script);
    if (!bases.length) return;
    var host = document.createElement("div");
    host.className = "harmonizer-widget";
    script.parentNode.insertBefore(host, script.nextSibling);

    var lang = pickLocale(script.getAttribute("data-lang"));

    function showLoadFail() {
      var root = host.shadowRoot || host.attachShadow({ mode: "open" });
      while (root.firstChild) root.removeChild(root.firstChild);
      root.appendChild(el("style", { text: LOAD_FAIL_CSS }));
      root.appendChild(el("div", { className: "hz-loadfail", text: LOAD_FAIL_TEXTS[lang] || LOAD_FAIL_TEXTS.ru }));
    }

    function start() {
      loadWidgetConfig(bases, id, lang, function (data, base) {
        if (!data) {
          // Every path is down right now: say so visibly and keep retrying in
          // the background — when a path recovers, the form appears by itself.
          showLoadFail();
          setTimeout(start, LOAD_RETRY_MS);
          return;
        }
        // The base that answered becomes the first choice for checkout.
        var ordered = [base].concat(bases.filter(function (b) {
          return b !== base;
        }));
        render(host, data, {
          apiBases: ordered,
          thanks: returnPaidId === id,
          unpaid: returnUnpaidId === id,
        });
      });
    }

    start();
  }

  function mountAll() {
    var scripts = document.querySelectorAll("script[data-id][src*='widget.js']");
    for (var i = 0; i < scripts.length; i++) mount(scripts[i]);
  }

  window.HarmonizerWidget = window.HarmonizerWidget || { render: render };

  var current = document.currentScript;
  if (current && current.getAttribute("data-id")) mount(current);
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountAll);
  } else {
    mountAll();
  }
})();
