import {useCallback,useRef,useState} from 'react';
import {Pressable,View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {router,type Href} from 'expo-router';
import type {CourseView} from '@shared/courses';
import {useAppLocale,useTranslate} from '@/modules/i18n';
import {openAccountCabinet,useAccountLinksEnabled} from '@/modules/account';
import {AppText} from '@/modules/ui/AppText';
import {AppButton} from '@/modules/ui/AppButton';
import {SurfaceCardView} from '@/modules/ui/SurfaceCardView';
import {SURFACE_CARD} from '@/modules/ui/surfaceCard';
import {useTheme} from '@/modules/ui/theme';
import {useCourses,showsOnDay} from './CoursesProvider';
import {CourseRowIcon} from './CourseRowIcon';
import {CourseCurrentCard} from './CourseContent';
import {courseStrings,courseControls} from './strings';
function DayCard({course,fromCache,refresh,onNavigate,minimumHeight}:{course:CourseView;fromCache:boolean;refresh:()=>Promise<void>;onNavigate:(y:number)=>void;minimumHeight:number}){
 const y=useRef(0);const [anchored,setAnchored]=useState(false);
 return <View style={anchored?{minHeight:minimumHeight}:undefined} onLayout={e=>{y.current=e.nativeEvent.layout.y;}}><CourseCurrentCard course={course} fromCache={fromCache} onBeforeLessonChange={()=>setAnchored(true)} onRetry={()=>void refresh()} onNavigate={()=>onNavigate(y.current)}/></View>;
}
export function DayCourseCards({onScrollToCourse,viewportHeight=0}:{onScrollToCourse?:(y:number)=>void;viewportHeight?:number}){
 const {courses,refresh,fromCache}=useCourses();const y=useRef(0);
 useFocusEffect(useCallback(()=>{void refresh();},[refresh]));
 const visible=courses.filter(c=>showsOnDay(c));if(!visible.length)return null;
 return <View onLayout={e=>{y.current=e.nativeEvent.layout.y;}} style={{gap:18}}>{visible.map((c,i)=><DayCard key={c.id} minimumHeight={i===visible.length-1?viewportHeight:0} course={c} fromCache={fromCache} refresh={refresh} onNavigate={offset=>onScrollToCourse?.(y.current+offset)}/>)}</View>;
}
export function MyCoursesCard(){
 const {courses,error,loading,refresh}=useCourses();const {locale}=useAppLocale();const {t}=useTranslate();const strings=courseStrings(locale);const controls=courseControls(locale);const theme=useTheme();
 const linksEnabled=useAccountLinksEnabled();const [opening,setOpening]=useState(false);const [cabinetError,setCabinetError]=useState(false);
 useFocusEffect(useCallback(()=>{void refresh();},[refresh]));
 const cabinet=async()=>{setOpening(true);setCabinetError(false);try{await openAccountCabinet();}catch{setCabinetError(true);}finally{setOpening(false);}};
 return <SurfaceCardView tone="elevated" style={{gap:SURFACE_CARD.titleToContentGap}}><AppText variant="sectionTitle">{strings.my}</AppText>
 {!courses.length?<><AppText tone="muted" variant="screenHint">{error?strings.error:loading?strings.loading:strings.empty}</AppText>
 {!error&&!loading&&linksEnabled?<AppButton label={controls.cabinet} disabled={opening} onPress={()=>void cabinet()}/>:null}
 {cabinetError?<AppText tone="danger">{t('gate.cabinetError')}</AppText>:null}</>:null}
 {courses.length?<View>{courses.map((c,i)=>{const available=c.state==='available'&&Date.parse(c.accessUntil)>Date.now();return <Pressable key={c.id} accessibilityRole="button" accessibilityLabel={available?c.title:`${c.title}. ${strings.expired}`} onPress={()=>router.push({pathname:'/course/[id]',params:{id:c.id}} as unknown as Href)} style={{minHeight:44,paddingVertical:8,flexDirection:'row',alignItems:'center',gap:4,borderBottomWidth:i<courses.length-1?1:0,borderColor:theme.colors.surfaceBorder}}>
 <CourseRowIcon kind={available?'arrow':'close'}/><AppText variant="screenHint" style={{flex:1}}>{c.title}</AppText></Pressable>;})}</View>:null}
 {error?<AppButton label={strings.retry} variant="secondary" onPress={()=>void refresh()}/>:null}</SurfaceCardView>;
}
