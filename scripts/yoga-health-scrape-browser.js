(async () => {
  const LESSONS = [
    41817529, 41817565, 41841901, 41920158, 42042358, 42049031, 42054149,
    42058305, 42064063, 42064093, 42133070, 42134533, 42515210, 42515211,
    42515212, 42515214, 44215106, 231186403,
  ];
  const MAIL = [
    772509, 772546, 772631, 782283, 782290, 782293, 782297, 782301, 782309,
    783719, 783732, 783738, 783751, 783764, 783776, 783829, 783845, 6583391,
  ];

  const DAY_NOTICE = 'Урок уже доступен вам во вкладке "День" Гармонизатора.';

  function norm(s) {
    return (s || "").replace(/\u00a0/g, " ").replace(/[ \t]+$/gm, "").trim();
  }

  function isTimingLine(t) {
    return /^\d{1,2}:\d{2}/.test(t) || /^\d{1,2}:\d{2}:\d{2}/.test(t);
  }

  function extractVimeo(h) {
    const a = [...h.matchAll(/player\.vimeo\.com\/video\/(\d+)/g)].map((m) => m[1]);
    const b = [...h.matchAll(/vimeo\.com\/(\d{6,})/g)].map((m) => m[1]);
    return [...new Set([...a, ...b])];
  }

  function formatMailing(html, id) {
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

    paras = paras.filter(
      (p) => !/Нажмите кнопку/i.test(p) && !/Перейти к уроку/i.test(p) && !/А сейчас Вас ожидает первый урок/i.test(p),
    );

    let goodbye = "";
    let sergey = "";
    if (paras.length && paras[paras.length - 1] === "Сергей Замковой") {
      sergey = paras.pop();
      if (paras.length) {
        const last = paras[paras.length - 1];
        if (/!$/.test(last) && last.length < 80) {
          goodbye = paras.pop();
        }
      }
    }

    let body = paras.join("\n\n");
    body = body.replace(/\n\n(- День \d+:)/g, "\n$1");
    const tail = goodbye
      ? `${DAY_NOTICE}\n\n${goodbye}\n${sergey}`
      : `${DAY_NOTICE}\n\n${sergey || "Сергей Замковой"}`;
    const text = body ? `${body}\n\n${tail}` : tail;

    return {
      id,
      subject: subj,
      text,
      url: `https://sergei.zamkovoi.ru/notifications/control/mailings/update/id/${id}`,
    };
  }

  function lessonChildrenToMarkdown(children, lessonNum) {
    const parts = [];
    const pushText = (s) => {
      if (!s) return;
      parts.push({ kind: "text", value: s });
    };
    const pushVideo = (id) => {
      parts.push({ kind: "video", value: id });
    };

    let i = 0;
    let skipAdditional = false;

    while (i < children.length) {
      const el = children[i];
      const h = el.outerHTML || "";
      const t = norm(el.innerText);

      const vids = extractVimeo(h);
      const yt = /youtube\.com\/embed\//i.test(h);

      if (/^дополнительно\s*:?$/i.test(t)) {
        skipAdditional = lessonNum === 1 || lessonNum === 5 ? "hard" : "soft";
        i++;
        continue;
      }
      if (skipAdditional === "hard") {
        i++;
        continue;
      }
      if (skipAdditional === "soft") {
        if (yt) {
          i++;
          continue;
        }
        if (/для расширения картины/i.test(t)) {
          i++;
          continue;
        }
        if (vids.length) {
          pushVideo(vids[0]);
          i++;
          continue;
        }
        skipAdditional = false;
      }

      if (/нет доступа к Ют/i.test(t)) {
        if (vids.length) pushVideo(vids[0]);
        i++;
        continue;
      }

      if (/^https?:\/\/vimeo\.com\/\d+$/i.test(t)) {
        pushVideo(t.match(/(\d+)/)[1]);
        i++;
        continue;
      }

      if (vids.length) {
        pushVideo(vids[0]);
        i++;
        continue;
      }

      if (yt) {
        i++;
        continue;
      }

      if (!t) {
        i++;
        continue;
      }

      if (t === "+++++++++++++++++" || /^\+{5,}$/.test(t)) {
        pushText("+++++++++++++++++");
        i++;
        continue;
      }

      if (/^Тайминг\s*:?$/i.test(t)) {
        const lines = ["Тайминг:"];
        i++;
        while (i < children.length) {
          const t2 = norm(children[i].innerText);
          if (!t2) {
            i++;
            continue;
          }
          if (!isTimingLine(t2)) break;
          lines.push(t2);
          i++;
        }
        pushText(lines.join("\n"));
        continue;
      }

      if (/^Задани[ея]\s*:?$/i.test(t)) {
        const label = t.endsWith(":") ? t : `${t}:`;
        i++;
        let task = "";
        while (i < children.length) {
          const t2 = norm(children[i].innerText);
          if (!t2) {
            i++;
            continue;
          }
          if (extractVimeo(children[i].outerHTML).length) break;
          if (/^\+{5,}$/.test(t2)) break;
          if (/^Тайминг/i.test(t2)) break;
          task = t2;
          i++;
          break;
        }
        pushText(task ? `${label}\n${task}` : label);
        continue;
      }

      pushText(t);
      i++;
    }

    const out = [];
    for (let p = 0; p < parts.length; p++) {
      const cur = parts[p];
      if (cur.kind === "video") {
        if (out.length && out[out.length - 1] !== "") out.push("");
        out.push(`**Видео:** https://player.vimeo.com/video/${cur.value}`);
        out.push("");
      } else {
        let text = cur.value;
        if (lessonNum === 18) {
          text = text.replace(
            /Нажмите кнопку,?\s*чтобы узнать подробности/gi,
            "Перейдите по ссылке, чтобы узнать подробности",
          );
          text = text.replace(/Получить ещё две практики\.{0,3}\s*$/im, "").trim();
          if (/Перейдите по ссылке, чтобы узнать подробности/.test(text)) {
            text = `${text}\n\n[Узнать подробности](https://zamkovoi.ru/3z2/)`;
          }
        }
        if (out.length && out[out.length - 1] !== "") out.push("");
        out.push(text);
      }
    }
    return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
  }

  function parseLesson(html, id, lessonNum) {
    const doc = new DOMParser().parseFromString(html, "text/html");
    const title = norm(doc.querySelector("title")?.textContent);
    const col = doc.querySelector(".content-row .col-md-12");
    if (!col) return { id, title, body: "", url: `https://sergei.zamkovoi.ru/teach/control/lesson/view/id/${id}` };
    const body = lessonChildrenToMarkdown([...col.children], lessonNum);
    return { id, title, body, url: `https://sergei.zamkovoi.ru/teach/control/lesson/view/id/${id}` };
  }

  const mailings = [];
  for (const id of MAIL) {
    const html = await (await fetch(`https://sergei.zamkovoi.ru/notifications/control/mailings/update/id/${id}`, {
      credentials: "include",
    })).text();
    mailings.push(formatMailing(html, id));
  }

  const lessons = [];
  for (let n = 0; n < LESSONS.length; n++) {
    const id = LESSONS[n];
    const html = await (await fetch(`https://sergei.zamkovoi.ru/teach/control/lesson/view/id/${id}`, {
      credentials: "include",
    })).text();
    lessons.push(parseLesson(html, id, n + 1));
  }

  return JSON.stringify({ mailings, lessons });
})();