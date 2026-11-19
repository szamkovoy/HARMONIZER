import {escapeCourseText,escapeCourseUrl,isCourseUrl} from '@shared/courseInline';

/** Convert only the supported formatting. Never store clipboard HTML or styles. */
export function lessonTextMarkdown(root:Node):string {
  const blockTags=new Set(['P','DIV','H1','H2','H3','H4','H5','H6','LI','UL','OL']);
  const children=(parent:Node):string=>{
    let result='';let previousBlock=false;let previousHeading=false;
    const nodes=Array.from(parent.childNodes);
    for(let index=0;index<nodes.length;index++){
      const node=nodes[index];const tag=node.nodeName;const block=blockTags.has(tag);
      // An empty paragraph contributes its boundary, not an extra browser placeholder BR.
      const value=visit(node);
      const heading=/^H[1-6]$/.test(tag);
      if(index>0&&(block||previousBlock)&&!result.endsWith('\n'))result+='\n';
      if(value&&result&&(heading||previousHeading)){
        const breaks=result.match(/\n*$/)![0].length;
        result+='\n'.repeat(Math.max(0,2-breaks));
      }
      result+=value;
      if(block&&index<nodes.length-1&&value==='')result+='\n';
      previousBlock=block;
      if(value)previousHeading=heading;
    }
    return result;
  };
  const visit=(node:Node):string=>{
    if(node.nodeType===3){
      const text=(node.textContent??'').replace(/\u00a0/g,' ');
      // Typed/pasted bare addresses remain clickable, including paths with underscores.
      if(node.parentElement?.closest('a'))return escapeCourseText(text);
      return text.split(/(https:\/\/[^\s<>]+)/i).map(part=>isCourseUrl(part)?`[${escapeCourseText(part)}](${escapeCourseUrl(part)})`:escapeCourseText(part)).join('');
    }
    if(node.nodeType!==1)return '';
    const element=node as HTMLElement;const tag=element.tagName;
    if(['SCRIPT','STYLE','IFRAME','OBJECT','SVG','IMG'].includes(tag))return '';
    if(tag==='BR')return '\n';
    let text=children(node);
    if(blockTags.has(tag)&&text.endsWith('\n'))text=text.slice(0,-1);
    if(!text)return '';
    if(tag==='A'){
      const url=element.getAttribute('href')??'';
      return isCourseUrl(url)?`[${text}](${escapeCourseUrl(url)})`:text;
    }
    const style=element.style;
    if(['B','STRONG'].includes(tag)||Number(style.fontWeight)>=600||style.fontWeight==='bold')text=`**${text}**`;
    if(['I','EM'].includes(tag)||style.fontStyle==='italic')text=`_${text}_`;
    if(['S','STRIKE','DEL'].includes(tag)||style.textDecoration.includes('line-through'))text=`~~${text}~~`;
    if(/^H[1-6]$/.test(tag))text=`### ${text}`;
    if(tag==='LI')text=`- ${text}`;
    return text;
  };
  return children(root).trim();
}
