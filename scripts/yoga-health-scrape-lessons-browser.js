(async () => {
  const LESSONS = [41817529,41817565,41841901,41920158,42042358,42049031,42054149,42058305,42064063,42064093,42133070,42134533,42515210,42515211,42515212,42515214,44215106,231186403];
  const norm = (s) => (s || "").replace(/\u00a0/g, " ").replace(/[ \t]+$/gm, "").trim();
  const isTimingLine = (t) => /^\d{1,2}:\d{2}/.test(t) || /^\d{1,2}:\d{2}:\d{2}/.test(t);
  const extractVimeo = (h) => {
    const a = [...h.matchAll(/player\.vimeo\.com\/video\/(\d+)/g)].map((m) => m[1]);
    const b = [...h.matchAll(/vimeo\.com\/(\d{6,})/g)].map((m) => m[1]);
    return [...new Set([...a, ...b])];
  };
  function lessonChildrenToMarkdown(children, lessonNum) {
    const parts = [];
    const pushText = (s) => { if (s) parts.push({ kind: "text", value: s }); };
    const pushVideo = (id) => parts.push({ kind: "video", value: id });
    let i = 0, skipAdditional = false;
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
        if (yt) { i++; continue; }
        if (/для расширения картины/i.test(t)) { i++; continue; }
        if (vids.length) { pushVideo(vids[0]); i++; continue; }
        skipAdditional = false;
      }
      if (/нет доступа к Ют/i.test(t)) {
        if (vids.length) pushVideo(vids[0]);
        i++;
        continue;
      }
      if (/^https?:\/\/vimeo\.com\/\d+$/i.test(t)) { pushVideo(t.match(/(\d+)/)[1]); i++; continue; }
      if (vids.length) { pushVideo(vids[0]); i++; continue; }
      if (yt) { i++; continue; }
      if (!t) { i++; continue; }
      if (t === "+++++++++++++++++" || /^\+{5,}$/.test(t)) { pushText("+++++++++++++++++"); i++; continue; }
      if (/^Тайминг\s*:?$/i.test(t)) {
        const lines = ["Тайминг:"];
        i++;
        while (i < children.length) {
          const t2 = norm(children[i].innerText);
          if (!t2) { i++; continue; }
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
          if (!t2) { i++; continue; }
          if (extractVimeo(children[i].outerHTML).length) break;
          if (/^\+{5,}$/.test(t2)) break;
          if (/^Тайминг/i.test(t2)) break;
          task = t2; i++; break;
        }
        pushText(task ? `${label}\n${task}` : label);
        continue;
      }
      const paras = t.split(/\n\n+/).map((x) => x.trim()).filter(Boolean);
      if (paras.length > 1) {
        for (const para of paras) pushText(para);
      } else {
        pushText(t);
      }
      i++;
    }
    const out = [];
    for (const cur of parts) {
      if (cur.kind === "video") {
        if (out.length && out[out.length - 1] !== "") out.push("");
        out.push(`**Видео:** https://player.vimeo.com/video/${cur.value}`);
        out.push("");
      } else {
        let text = cur.value;
        if (lessonNum === 18) {
          text = text.replace(/Нажмите кнопку,?\s*чтобы узнать подробности/gi, "Перейдите по ссылке, чтобы узнать подробности");
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
  const lessons = [];
  for (let n = 0; n < LESSONS.length; n++) {
    const id = LESSONS[n];
    const html = await (await fetch(`https://sergei.zamkovoi.ru/teach/control/lesson/view/id/${id}`, { credentials: "include" })).text();
    const doc = new DOMParser().parseFromString(html, "text/html");
    const title = norm(doc.querySelector("title")?.textContent);
    const col = doc.querySelector(".content-row .col-md-12");
    const body = col ? lessonChildrenToMarkdown([...col.children], n + 1) : "";
    lessons.push({ id, title, body });
  }
  return JSON.stringify(lessons);
})();