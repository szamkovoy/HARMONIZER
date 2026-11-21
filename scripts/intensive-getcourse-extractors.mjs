/** Read-only DOM extractors. Paste the needed function into browser evaluate;
 * pass document explicitly if running a DOM fixture. Never read cookies or submit forms.
 */
export function intensiveLessonIndex(doc=document){
 const rows=[...doc.querySelectorAll('.lesson-list > li')];
 const lessons=rows.map((row,i)=>{
  const path=row.getAttribute('onclick')?.match(/location\.href=['"]([^'"]+)['"]/)?.[1];
  if(!path)throw new Error('Не найдена ссылка урока '+(i+1));
  return {position:i+1,title:row.textContent.replace(/Не показывается ученикам/g,'').trim(),sourceUrl:new URL(path,doc.location.href).href};
 });
 if(lessons.length!==30)throw new Error('Ожидалось 30 уроков; найдено '+lessons.length);
 return lessons;
}
export function intensiveVideo(doc=document){
 const ids=[...new Set([...doc.querySelectorAll('iframe[src]')].map(frame=>frame.getAttribute('src')?.match(/^https:\/\/player\.vimeo\.com\/video\/(\d+)/)?.[1]).filter(Boolean))];
 if(ids.length!==1)throw new Error('Ожидалось одно видео Vimeo; найдено '+ids.length);
 return {sourceUrl:doc.location.href,vimeoId:ids[0]};
}
export function intensiveMailingIndex(doc=document){
 return [...doc.querySelectorAll('a[href]')].map(link=>({sourceNumber:Number(link.textContent.match(/Практика\s+(\d+)/i)?.[1]),title:link.textContent.trim(),sourceUrl:link.href}))
  .filter(item=>item.sourceNumber>=1&&item.sourceNumber<=29&&/\/notifications\/control\/mailings\/update\/id\//.test(item.sourceUrl));
}
export function intensiveAdvice(templateKey,doc=document){
 const subject=doc.querySelector('#Mailing_subject')?.value??'';
 const sourceNumber=Number(subject.match(/Практика\s+(\d+)/i)?.[1]);
 if(!Number.isInteger(sourceNumber)||sourceNumber<1||sourceNumber>29)throw new Error('Это не письмо Практика 1–29');
 const body=doc.querySelector('#bodyCell');if(!body)throw new Error('Не найден просмотр письма');
 const text=body.innerText;const marker=text.match(/Совет\s+дня\s*:/i);if(!marker)throw new Error('Нет маркера Совета дня');
 const rest=text.slice(marker.index+marker[0].length);
 let end;
 if(templateKey==='love')end=rest.search(/Цитата\s*:/i);
 else{
  const buttons=[...body.querySelectorAll('a[data-button="button"]')];
  if(buttons.length!==1)throw new Error('Ожидалась одна кнопка урока');
  end=rest.indexOf(buttons[0].innerText.trim());
 }
 if(end<0||end===undefined)throw new Error('Не найден конец совета; не импортировать письмо целиком');
 const markdown=rest.slice(0,end).trim();if(!markdown)throw new Error('Пустой совет');
 return {sourceNumber,sourceUrl:doc.location.href,markdown};
}
