import {useCallback,useEffect,useRef,useState} from 'react';
import {Linking,PixelRatio,Platform,Pressable,StyleSheet,Text,useWindowDimensions,View} from 'react-native';
import {router,type Href} from 'expo-router';
import {Ionicons} from '@expo/vector-icons';
import type {CourseBlock,CourseLesson,CourseView} from '@shared/courses';
import {useAppLocale} from '@/modules/i18n';
import {useRemotePlay} from '@/modules/remote-play';
import {vimeoAudiotrackForLocale} from '@/modules/practices/core/vimeo';
import {PhoneVimeoPlayer} from '@/modules/practices/ui/PhoneVimeoPlayer';
import {PracticeKeepAwake} from '@/modules/ui/PracticeKeepAwake';
import {useFocusEffect,useIsFocused} from '@react-navigation/native';
import {AppText} from '@/modules/ui/AppText';
import {AppButton} from '@/modules/ui/AppButton';
import {SurfaceCardView} from '@/modules/ui/SurfaceCardView';
import {useTheme} from '@/modules/ui/theme';
import {courseStrings,courseControls,courseLessonCount} from './strings';
import {CourseRowIcon} from './CourseRowIcon';
import {loadCourse,CourseRequestError} from './client';
import {courseInline,type CourseInline} from '@shared/courseInline';
import {courseTextLineHeight} from './textLayout';
import {intensiveDayTitle} from './state';

function Inline({nodes}:{nodes:CourseInline[]}){
 const theme=useTheme();
 return <>{nodes.map((node,i)=>{
  if(node.type==='text')return node.text;
  const children=<Inline nodes={node.children}/>;
  if(node.type==='link')return <Text key={i} style={{color:theme.colors.accent,textDecorationLine:'underline'}} onPress={()=>void Linking.openURL(node.url)} accessibilityRole="link">{children}</Text>;
  return <Text key={i} style={node.type==='bold'?{fontWeight:'700'}:node.type==='italic'?{fontStyle:'italic'}:{textDecorationLine:'line-through'}}>{children}</Text>;
 })}</>;
}
export function CourseMarkdown({text}:{text:string}){
 const theme=useTheme();const {fontScale}=useWindowDimensions();
 return <View style={{gap:12}}>{text.trim().split(/\n\s*\n/).map((paragraph,i)=>{
  const variant=/^#{1,6} /.test(paragraph)?'contentTitle':'screenHint';
  const style=Platform.OS==='ios'?{lineHeight:courseTextLineHeight(theme.typography[variant].lineHeight,PixelRatio.get(),fontScale)}:undefined;
  return <AppText key={i} variant={variant} style={style}><Inline nodes={courseInline(paragraph.replace(/^#{1,6} /,''))}/></AppText>;
 })}</View>;
}
function CourseVideo({block,title,bilingual=false}:{block:Extract<CourseBlock,{type:'video'}>;title:string;bilingual?:boolean}){
 const {locale}=useAppLocale();const strings=courseStrings(locale);const remote=useRemotePlay();
 const [busy,setBusy]=useState(false);const [failed,setFailed]=useState(false);
 const [playing,setPlaying]=useState(false);const focused=useIsFocused();
 useEffect(()=>{if(!focused)setPlaying(false);},[focused]);
 const audio=vimeoAudiotrackForLocale(bilingual?locale:'ru');
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
export function CourseBlocks({blocks,title,bilingual=false}:{blocks:CourseBlock[];title:string;bilingual?:boolean}){
 return <View style={{gap:16}}>{blocks.map((block,i)=>block.type==='text'?<CourseMarkdown key={i} text={block.markdown}/>:<CourseVideo key={block.vimeoId+'-'+i} block={block} title={title} bilingual={bilingual}/>)}</View>;
}
export function CourseCurrentCard({course,archive=false,showCourseTitle=true,fromCache=false,onNavigate,onBeforeLessonChange,onRetry}:{
 course:CourseView;archive?:boolean;showCourseTitle?:boolean;fromCache?:boolean;onNavigate?:()=>void;onBeforeLessonChange?:()=>void;onRetry?:()=>void;
}){
 const {locale}=useAppLocale();const strings=courseStrings(locale);const controls=courseControls(locale);const theme=useTheme();
 const intensive=course.kind==='intensive';const canNavigate=!intensive||course.reviewAllLessons===true;
 const [expanded,setExpanded]=useState(archive);
 const [selectedId,setSelectedId]=useState<string|null>(archive?null:course.current?.id??null);
 const [lesson,setLesson]=useState<CourseLesson|null>(archive?null:course.current);
 const [focusVersion,setFocusVersion]=useState(0);
 const previousCurrent=useRef(course.current?.id);
 useEffect(()=>{if(previousCurrent.current!==course.current?.id&&!archive)setSelectedId(course.current?.id??null);previousCurrent.current=course.current?.id;},[course.current?.id,archive]);
 const [loading,setLoading]=useState(false);const [error,setError]=useState(false);const [retry,setRetry]=useState(0);
 const pendingScroll=useRef(false);const navigate=useRef(onNavigate);navigate.current=onNavigate;
 const cache=useRef(new Map<string,CourseLesson>());const request=useRef(0);const latest=useRef(course);latest.current=course;
 useEffect(()=>{if(course.current&&!fromCache)cache.current.set(course.current.id,course.current);},[course.current,fromCache]);
 useFocusEffect(useCallback(()=>{
  setExpanded(archive);setSelectedId(archive?null:latest.current.current?.id??null);setFocusVersion(n=>n+1);
  return()=>{request.current++;};
 },[course.id,archive]));
 useEffect(()=>{
  const version=++request.current;
  if(!selectedId){setLesson(null);setError(false);setLoading(false);return;}
  if(!course.lessons.some(l=>l.id===selectedId)){setSelectedId(archive?null:course.current?.id??null);return;}
  if(selectedId===course.current?.id&&!fromCache){setLesson(course.current);setError(false);setLoading(false);return;}
  setLesson(cache.current.get(selectedId)??null);setLoading(true);setError(false);
  void loadCourse(course.id,selectedId).then(({course:result})=>{
   if(request.current!==version)return;
   if(!result.current||result.current.id!==selectedId)throw new CourseRequestError(404);
   cache.current.set(selectedId,result.current);setLesson(result.current);
  }).catch(err=>{
   if(request.current!==version)return;
   if(err instanceof CourseRequestError&&[403,404].includes(err.status)){cache.current.delete(selectedId);setLesson(null);}
   setError(true);
  }).finally(()=>{if(request.current===version)setLoading(false);});
  return()=>{request.current++;};
 },[course.id,course.current,course.lessons,selectedId,archive,fromCache,retry,focusVersion]);
 // Arrow navigation keeps the viewport. Only a selection from the list returns to the heading,
 // after the selected content (or its error) is laid out, rather than during a short loading state.
 useEffect(()=>{
  if(pendingScroll.current&&!loading&&(lesson?.id===selectedId||error)){
   const frame=requestAnimationFrame(()=>{if(pendingScroll.current){pendingScroll.current=false;navigate.current?.();}});
   return()=>cancelAnimationFrame(frame);
  }
 },[selectedId,lesson,loading,error]);
 const choose=(id:string,fromList=false)=>{
  onBeforeLessonChange?.();
  if(fromList&&id===selectedId)requestAnimationFrame(()=>navigate.current?.());
  else pendingScroll.current=fromList;
  setSelectedId(id);
 };
 const index=course.lessons.findIndex(l=>l.id===selectedId);
 const previous=canNavigate&&index>0?course.lessons[index-1]:null;const next=canNavigate&&index>=0?course.lessons[index+1]:null;
 const selected=course.lessons.find(l=>l.id===selectedId);
 const title=intensive&&selected?intensiveDayTitle(locale,selected.position):selected?.title;
 if(Date.parse(course.accessUntil)<=Date.now())return null;
 if(intensive&&!course.reviewAllLessons&&course.currentUntil&&Date.parse(course.currentUntil)<=Date.now())return <SurfaceCardView tone="elevated"><AppText tone="muted">{strings.loading}</AppText><AppButton label={strings.retry} variant="secondary" onPress={()=>onRetry?.()}/></SurfaceCardView>;
 return <SurfaceCardView tone="elevated" style={showCourseTitle?undefined:{paddingTop:theme.surfaceCard.padding-4}}>
 {showCourseTitle||selectedId?<View style={{gap:theme.surfaceCard.gap-4}}>
 {showCourseTitle?<AppText variant="sectionTitle">{course.title}</AppText>:null}
 {/* Keep the title row stable before the second lesson introduces navigation buttons. */}
 {selectedId?<View style={{minHeight:44,flexDirection:'row',alignItems:'center',gap:8}}>
   <AppText variant="contentTitle" style={{flex:1}}>{title||strings.lesson}</AppText>
   {previous?<Pressable accessibilityRole="button" accessibilityLabel={controls.previous} onPress={()=>choose(previous.id)} style={{paddingHorizontal:10,paddingVertical:9}}><Ionicons name="chevron-back" size={26} color={theme.colors.accent}/></Pressable>:null}
   {next?<Pressable accessibilityRole="button" accessibilityLabel={controls.next} onPress={()=>choose(next.id)} style={{paddingHorizontal:10,paddingVertical:9}}><Ionicons name="chevron-forward" size={26} color={theme.colors.accent}/></Pressable>:null}
  </View>:null}
 </View>:null}
 {selectedId?<>
  {loading&&!lesson?<AppText tone="muted">{strings.loading}</AppText>:null}
  {selected&&lesson?.id===selectedId?<CourseBlocks blocks={intensive&&locale!=='ru'?(lesson.blocksI18n?.[locale]??lesson.blocksI18n?.en??lesson.blocks):lesson.blocks} title={`${course.title} · ${title||lesson.title}`} bilingual={intensive}/>:null}
 </>:null}
 {error||(fromCache&&!lesson)?<View style={{gap:12}}><AppText tone="muted">{error?strings.error:strings.loading}</AppText><AppButton label={strings.retry} variant="secondary" onPress={()=>{setRetry(n=>n+1);onRetry?.();}}/></View>:null}
 {!intensive?<View>
 <Pressable accessibilityRole="button" accessibilityState={{expanded}} onPress={()=>setExpanded(v=>!v)} style={{minHeight:44,flexDirection:'row',alignItems:'center',gap:4}}>
  <CourseRowIcon kind={expanded?'expanded':'collapsed'} tone="accent"/>
  <AppText variant="screenHint" tone="accent" style={{flex:1}}>{strings.all} ({courseLessonCount(locale,course.lessons.length,course.totalLessons??course.lessons.length)})</AppText>
 </Pressable>
 {expanded?<View>{course.lessons.map((l,i)=><Pressable key={l.id} accessibilityRole="button" accessibilityState={{selected:l.id===selectedId}} onPress={()=>choose(l.id,true)} style={{paddingVertical:8,minHeight:44,flexDirection:'row',alignItems:'center',gap:4,borderBottomWidth:i<course.lessons.length-1?StyleSheet.hairlineWidth:0,borderColor:theme.colors.surfaceBorder}}>
  <CourseRowIcon kind="arrow" tone={l.id===selectedId?'accent':'primary'}/>
  <AppText variant="screenHint" style={{flex:1}} tone={l.id===selectedId?'accent':'primary'}>{l.title}</AppText>
 </Pressable>)}</View>:null}
 </View>:null}
 </SurfaceCardView>;
}
