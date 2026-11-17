import {useEffect,useState} from 'react';
import {Linking,Pressable,Text,View} from 'react-native';
import {router,type Href} from 'expo-router';
import type {CourseBlock,CourseView} from '@shared/courses';
import {useAppLocale} from '@/modules/i18n';
import {useRemotePlay} from '@/modules/remote-play';
import {vimeoAudiotrackForLocale} from '@/modules/practices/core/vimeo';
import {PhoneVimeoPlayer} from '@/modules/practices/ui/PhoneVimeoPlayer';
import {PracticeKeepAwake} from '@/modules/ui/PracticeKeepAwake';
import {useIsFocused} from '@react-navigation/native';
import {AppText} from '@/modules/ui/AppText';
import {AppButton} from '@/modules/ui/AppButton';
import {SurfaceCardView} from '@/modules/ui/SurfaceCardView';
import {useTheme} from '@/modules/ui/theme';
import {courseStrings} from './strings';

function Inline({text}:{text:string}){
 const theme=useTheme();const parts=text.split(/(\[[^\]]+\]\(https:\/\/[^\s)]+\)|https:\/\/[^\s]+|\*\*[^*]+\*\*)/g);
 return <>{parts.map((part,i)=>{
  const link=part.match(/^\[([^\]]+)\]\((https:\/\/[^\s)]+)\)$/);const url=link?.[2]||(/^https:\/\//.test(part)?part:null);
  if(url)return <Text key={i} style={{color:theme.colors.accent,textDecorationLine:'underline'}} onPress={()=>void Linking.openURL(url)} accessibilityRole="link">{link?.[1]||part}</Text>;
  if(part.startsWith('**')&&part.endsWith('**'))return <Text key={i} style={{fontWeight:'700'}}>{part.slice(2,-2)}</Text>;
  return <Text key={i}>{part}</Text>;
 })}</>;
}
export function CourseMarkdown({text}:{text:string}){
 return <View style={{gap:12}}>{text.trim().split(/\n\s*\n/).map((paragraph,i)=>{
  const heading=/^#{1,6} /.test(paragraph);return <AppText key={i} variant={heading?'sectionTitle':'dialogBody'}><Inline text={paragraph.replace(/^#{1,6} /,'')}/></AppText>;
 })}</View>;
}
function CourseVideo({block,title}:{block:Extract<CourseBlock,{type:'video'}>;title:string}){
 const {locale}=useAppLocale();const strings=courseStrings(locale);const remote=useRemotePlay();
 const [busy,setBusy]=useState(false);const [failed,setFailed]=useState(false);
 const [playing,setPlaying]=useState(false);const focused=useIsFocused();
 useEffect(()=>{if(!focused)setPlaying(false);},[focused]);
 const audio=vimeoAudiotrackForLocale(locale);
 const tv=async()=>{setBusy(true);setFailed(false);const params={vimeoId:block.vimeoId,title,audiotrack:audio,launchSource:'course',...(block.practiceId?{practiceId:block.practiceId}:{})};
  try{if(remote.connected){await remote.playVimeo(block.vimeoId,audio);router.push({pathname:'/tv-remote',params} as unknown as Href);}else router.push({pathname:'/connect-tv',params} as unknown as Href);}
  catch{setFailed(true);}finally{setBusy(false);}
 };
 return <View style={{gap:8}}>{playing&&focused?<PracticeKeepAwake tag={`course-${block.vimeoId}`}/>:null}{focused?<PhoneVimeoPlayer autoplay={false} vimeoId={block.vimeoId} audiotrack={audio} loading={false} strings={{phoneVideoMissing:strings.unavailable}} onMessage={event=>{
  try{const data=JSON.parse(event.nativeEvent.data);if(data.type==='play')setPlaying(true);if(data.type==='pause'||data.type==='ended'||data.type==='error')setPlaying(false);}catch{/* Ignore non-player messages. */}
 }}/>:<View style={{aspectRatio:16/9}}/>}
 <AppButton label={busy?strings.loading:strings.tv} variant="secondary" onPress={()=>void tv()} disabled={busy}/>
 {failed?<AppText tone="danger">{strings.unavailable}</AppText>:null}</View>;
}
export function CourseBlocks({blocks,title}:{blocks:CourseBlock[];title:string}){
 return <View style={{gap:16}}>{blocks.map((block,i)=>block.type==='text'?<CourseMarkdown key={i} text={block.markdown}/>:<CourseVideo key={block.vimeoId+'-'+i} block={block} title={title}/>)}</View>;
}
export function CourseCurrentCard({course,onLesson}:{course:CourseView;onLesson?:(id:string)=>void}){
 const {locale}=useAppLocale();const strings=courseStrings(locale);const theme=useTheme();const [expanded,setExpanded]=useState(false);
 const open=(id:string)=>onLesson?onLesson(id):router.push({pathname:'/course/[id]',params:{id:course.id,lessonId:id}} as unknown as Href);
 if(!course.current||Date.parse(course.accessUntil)<=Date.now())return null;
 return <SurfaceCardView tone="elevated"><AppText variant="sectionTitle">{course.title}</AppText>
 <AppText variant="dialogTitle">{course.current.title}</AppText>
 <CourseBlocks blocks={course.current.blocks} title={`${course.title} · ${course.current.title}`}/>
 <Pressable accessibilityRole="button" accessibilityState={{expanded}} onPress={()=>setExpanded(v=>!v)} style={{paddingVertical:12}}>
 <AppText tone="accent">{expanded?'▾':'▸'} {expanded?strings.hide:strings.all}</AppText></Pressable>
 {expanded?<View style={{gap:8}}>{course.lessons.map(l=><Pressable key={l.id} accessibilityRole="button" onPress={()=>open(l.id)} style={{paddingVertical:10,borderBottomWidth:1,borderColor:theme.colors.surfaceBorder}}>
 <AppText tone={l.id===course.current?.id?'accent':'primary'}>{l.title} →</AppText></Pressable>)}</View>:null}
 </SurfaceCardView>;
}
