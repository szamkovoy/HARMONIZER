(async () => {
  const MAIL = [772509,772546,772631,782283,782290,782293,782297,782301,782309,783719,783732,783738,783751,783764,783776,783829,783845,6583391];
  const DAY_NOTICE = 'Урок уже доступен вам во вкладке "День" Гармонизатора.';
  const norm = (s) => (s || "").replace(/\u00a0/g, " ").trim();
  const out = [];
  for (const id of MAIL) {
    const html = await (await fetch(`https://sergei.zamkovoi.ru/notifications/control/mailings/update/id/${id}`, { credentials: "include" })).text();
    const subj = (html.match(/id="Mailing_subject"[^>]*value="([^"]*)"/) || [])[1] || "";
    const doc = new DOMParser().parseFromString(html, "text/html");
    let bodyHtml = "";
    for (const t of doc.querySelectorAll("textarea")) {
      const v = t.textContent || "";
      if (v.length > bodyHtml.length && (v.includes("f-text") || v.includes("Здравствуйте"))) bodyHtml = v;
    }
    const d = document.createElement("div");
    d.innerHTML = bodyHtml;
    const splitFText = (el) => {
      const full = norm(el.innerText);
      const ps = [...el.querySelectorAll(":scope p")];
      if (ps.length) {
        const fromP = ps.map((p) => norm(p.innerText)).filter(Boolean);
        if (
          ps.length === 1 &&
          /^Здравствуйте,/.test(fromP[0] || "") &&
          full.length > (fromP[0] || "").length + 15
        ) {
          const greeting = fromP[0];
          const rest = full.slice(greeting.length).trim();
          return rest ? [greeting, rest] : fromP;
        }
        return fromP;
      }
      let text = norm(el.innerText);
      if (!text) return [];
      if (/^Здравствуйте,[^\n]+\n/.test(text)) {
        const greeting = text.match(/^[^\n]+/)[0];
        const rest = text.slice(greeting.length).trim();
        return rest ? [greeting, rest] : [greeting];
      }
      if (/Сергей Замковой\s*$/.test(text)) {
        const body = text.replace(/\s*Сергей Замковой\s*$/, "").trim();
        const parts = body.split(/\n+/).map((x) => x.trim()).filter(Boolean);
        return [...parts, "Сергей Замковой"];
      }
      return [text];
    };
    let paras = [];
    for (const ft of d.querySelectorAll(".f-text")) {
      paras.push(...splitFText(ft));
    }
    paras = paras.filter((p) => !/Нажмите кнопку/i.test(p) && !/Перейти к уроку/i.test(p) && !/А сейчас Вас ожидает первый урок/i.test(p));
    let goodbye = "", sergey = "";
    if (paras.length && paras[paras.length - 1] === "Сергей Замковой") {
      sergey = paras.pop();
      if (paras.length && /!$/.test(paras[paras.length - 1]) && paras[paras.length - 1].length < 80) goodbye = paras.pop();
    }
    let body = paras.join("\n\n");
    body = body.replace(/\n\n(- День \d+:)/g, "\n$1");
    const tail = goodbye ? `${DAY_NOTICE}\n\n${goodbye}\n${sergey}` : `${DAY_NOTICE}\n\n${sergey || "Сергей Замковой"}`;
    out.push({ id, subject: subj, text: body ? `${body}\n\n${tail}` : tail });
  }
  return JSON.stringify(out);
})();