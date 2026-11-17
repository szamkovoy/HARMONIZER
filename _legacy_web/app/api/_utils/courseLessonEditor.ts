import type {CourseBlock} from '@shared/courses';
export function vimeoIdFromInput(input:string):string {
 const value=input.trim();if(/^\d{5,15}$/.test(value))return value;
 let url:URL;try{url=new URL(value);}catch{throw new Error('Укажите ссылку Vimeo или числовой ID видео');}
 if(url.protocol!=='https:'||!['vimeo.com','www.vimeo.com','player.vimeo.com'].includes(url.hostname))throw new Error('Нужна HTTPS-ссылка на Vimeo');
 const match=url.pathname.match(/^\/(?:video\/)?(\d{5,15})(?:\/[a-zA-Z0-9]+)?\/?$/);
 if(!match)throw new Error('Не удалось определить видео по ссылке Vimeo');return match[1];
}
export function validateCourseLesson(body:unknown,previous:CourseBlock[]):{title:string;blocks:CourseBlock[]} {
 if(!body||typeof body!=='object')throw new Error('Не передан урок');
 const {title,blocks}=body as {title:unknown;blocks:unknown};
 if(typeof title!=='string'||!title.trim()||title.length>500)throw new Error('Название урока: от 1 до 500 символов');
 if(!Array.isArray(blocks)||!blocks.length||blocks.length>100)throw new Error('В уроке должно быть от 1 до 100 блоков');
 const result=blocks.map((b):CourseBlock=>{
  if(b?.type==='text'&&typeof b.markdown==='string'&&b.markdown.trim()&&b.markdown.length<=100000)return {type:'text',markdown:b.markdown};
  if(b?.type==='video'&&typeof b.vimeoId==='string'){
   const id=vimeoIdFromInput(b.vimeoId);
   const source=previous.find(p=>p.type==='video'&&p.vimeoId===id);
   return {type:'video',vimeoId:id,...(source?.type==='video'&&source.practiceId?{practiceId:source.practiceId}:{})};
  }
  throw new Error('Проверьте текст и ссылку на видео во всех блоках');
 });
 return {title:title.trim(),blocks:result};
}
