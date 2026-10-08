/*!
 * HARMONIZER landing payment widget.
 * Embed: <script src="https://harmonizer.zamkovoi.yoga/widget.js" data-id="WIDGET_ID" data-lang="auto" async></script>
 * data-lang: ru | en | de | fr | it | es | pt | nl | auto (browser language; widget main language if no translation).
 * Each <script> renders its own independent form right where it stands.
 */
(function () {
  "use strict";

  var LOCALES = ["ru", "en", "de", "fr", "it", "es", "pt", "nl"];
  var counter = 0;

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
      ".methods{display:flex;flex-direction:column;gap:8px;text-align:left;}",
      ".method{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid rgba(127,127,127,.35);border-radius:" + style.controlRadius + "px;cursor:pointer;}",
      ".method.on{border-color:" + style.accentColor + ";box-shadow:0 0 0 1px " + style.accentColor + " inset;}",
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
      ".err{color:#dc2626;font-size:.88em;}",
      ".hp{position:absolute!important;left:-10000px!important;width:1px;height:1px;overflow:hidden;}",
      ".thanks .title{margin-bottom:4px;}",
    ].join("");
  }

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
   * opts.apiBase — origin for checkout; opts.thanks — render the thank-you state.
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
    var state = { method: data.defaultMethod || methods[0] || null };
    var showChoice = data.paymentMode === "choice" && methods.length > 1;
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
        row.node.className = "method" + (row.method === state.method ? " on" : "");
      });
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
          methods.forEach(function (m) {
            var input = el("input", {
              type: "radio",
              name: uid + "-method",
              value: m,
              checked: m === state.method,
            });
            input.addEventListener("change", function () {
              state.method = m;
              updatePrice();
            });
            var row = el("label", { className: "method" }, [
              input,
              el("span", { text: m === "ru" ? t.methodRu : t.methodInt }),
            ]);
            radioRows.push({ method: m, node: row });
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
      button.disabled = true;
      button.textContent = t.processing;
      fetch(opts.apiBase + "/api/widget/" + encodeURIComponent(data.id) + "/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name,
          email: email,
          method: state.method,
          lang: data.locale,
          pageUrl: window.location.href,
          website: honeypot.value,
        }),
      })
        .then(function (res) {
          return res.json().catch(function () {
            return {};
          });
        })
        .then(function (out) {
          if (out && out.paymentUrl) {
            window.location.href = out.paymentUrl;
            return;
          }
          var key = (out && ERROR_TEXT[out.error]) || "errGeneric";
          if (out && out.error === "invalid_email") emailInput.classList.add("bad");
          if (out && out.error === "invalid_name" && nameInput) nameInput.classList.add("bad");
          showError(t[key] || t.errGeneric);
          button.disabled = false;
          button.textContent = t.button;
        })
        .catch(function () {
          showError(t.errGeneric);
          button.disabled = false;
          button.textContent = t.button;
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

  function paidWidgetId() {
    try {
      return new URL(window.location.href).searchParams.get("hz_paid");
    } catch (e) {
      return null;
    }
  }

  function mount(script) {
    if (script.getAttribute("data-hz-mounted")) return;
    script.setAttribute("data-hz-mounted", "1");
    var id = (script.getAttribute("data-id") || "").trim();
    if (!id) return;
    var apiBase;
    try {
      apiBase = new URL(script.src, window.location.href).origin;
    } catch (e) {
      return;
    }
    var host = document.createElement("div");
    host.className = "harmonizer-widget";
    script.parentNode.insertBefore(host, script.nextSibling);

    var lang = pickLocale(script.getAttribute("data-lang"));
    var url =
      apiBase + "/api/widget/" + encodeURIComponent(id) +
      "?lang=" + encodeURIComponent(lang) + "&tz=" + encodeURIComponent(timeZone());
    fetch(url)
      .then(function (res) {
        return res.ok ? res.json() : null;
      })
      .then(function (data) {
        if (!data || !data.texts) return;
        render(host, data, { apiBase: apiBase, thanks: paidWidgetId() === id });
      })
      .catch(function () {
        /* widget stays empty; the landing page keeps working */
      });
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
