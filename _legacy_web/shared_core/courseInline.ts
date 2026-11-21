/** The same small, HTML-free Markdown subset in the lesson editor, mail and native app. */
export type CourseInline =
  | {type:'text';text:string}
  | {type:'link';url:string;children:CourseInline[]}
  | {type:'bold'|'italic'|'strike';children:CourseInline[]};

export const escapeCourseText = (text:string) => text.replace(/[\\*_~\[\]]/g,'\\$&');
export const escapeCourseUrl = (url:string) => url.replace(/[\\()]/g,'\\$&');
export const isCourseUrl = (url:string) => /^https:\/\/[^\s<>"\\]+$/i.test(url);

export function courseInline(text:string,depth=0,allowLinks=true):CourseInline[] {
  if(depth>12)return [{type:'text',text}];
  const nodes:CourseInline[]=[];
  const plain=(value:string)=>{
    const previous=nodes.at(-1);
    if(previous?.type==='text')previous.text+=value;else nodes.push({type:'text',text:value});
  };
  let i=0;
  while(i<text.length){
    if(text[i]==='\\'&&/[\\*_~\[\]()]/.test(text[i+1]??'')){plain(text[i+1]);i+=2;continue;}
    if(allowLinks&&text[i]==='['){
      let end=i+1;
      for(;end<text.length;end++){
        if(text[end]==='\\'){end++;continue;}
        if(text.startsWith('](',end))break;
      }
      if(end<text.length){
        let cursor=end+2;let nesting=1;
        for(;cursor<text.length;cursor++){
          if(text[cursor]==='\\'){cursor++;continue;}
          if(text[cursor]==='(')nesting++;
          if(text[cursor]===')'&&!--nesting)break;
        }
        const url=text.slice(end+2,cursor).replace(/\\([\\()])/g,'$1');
        if(nesting===0&&isCourseUrl(url)){
          nodes.push({type:'link',url,children:courseInline(text.slice(i+1,end),depth+1,false)});i=cursor+1;continue;
        }
      }
    }
    const bare=allowLinks?text.slice(i).match(/^https:\/\/[^\s<>]+/i)?.[0]:undefined;
    if(bare&&isCourseUrl(bare)){nodes.push({type:'link',url:bare,children:[{type:'text',text:bare}]});i+=bare.length;continue;}
    const delimiter=text.startsWith('**',i)?'**':text.startsWith('~~',i)?'~~':text[i]==='_'?'_':null;
    if(delimiter){
      let end=text.indexOf(delimiter,i+delimiter.length);
      while(end>=0&&text[end-1]==='\\')end=text.indexOf(delimiter,end+delimiter.length);
      if(end>i+delimiter.length){
        nodes.push({type:delimiter==='**'?'bold':delimiter==='_'?'italic':'strike',children:courseInline(text.slice(i+delimiter.length,end),depth+1,allowLinks)});
        i=end+delimiter.length;continue;
      }
    }
    plain(text[i++]);
  }
  return nodes;
}

const escapeHtml=(text:string)=>text.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
export function courseInlineHtml(nodes:CourseInline[]):string {
  return nodes.map(node=>{
    if(node.type==='text')return escapeHtml(node.text);
    const content=courseInlineHtml(node.children);
    if(node.type==='link')return `<a href="${escapeHtml(node.url)}">${content}</a>`;
    const tag={bold:'strong',italic:'em',strike:'s'}[node.type];
    return `<${tag}>${content}</${tag}>`;
  }).join('');
}
