import {useCallback,useEffect,useRef,useState} from 'react';
import {ActivityIndicator,AppState,View} from 'react-native';
import {router,useLocalSearchParams} from 'expo-router';
import {useFocusEffect} from '@react-navigation/native';
import type {CourseView} from '@shared/courses';
import {useAppLocale} from '@/modules/i18n';
import {loadCourse} from '@/modules/courses/client';
import {courseStrings} from '@/modules/courses/strings';
import {CourseCurrentCard} from '@/modules/courses/CourseContent';
import {AppText} from '@/modules/ui/AppText';
import {AppButton} from '@/modules/ui/AppButton';
import {FloatingCloseButton} from '@/modules/ui/FloatingCloseButton';
import {StackScreenLayout,StackScrollView} from '@/modules/ui/StackScreenLayout';
import {ScreenHeader} from '@/modules/ui/ScreenHeader';
import {useTheme} from '@/modules/ui/theme';
import {useAuth} from '@/modules/auth';
export default function CourseScreen(){
 const {id,lessonId}=useLocalSearchParams<{id:string;lessonId?:string}>();const {locale}=useAppLocale();const strings=courseStrings(locale);const theme=useTheme();
 const [selected,setSelected]=useState(lessonId);const [course,setCourse]=useState<CourseView|null>(null);const [error,setError]=useState(false);
 const {authUser}=useAuth();const request=useRef(0);
 const load=useCallback(()=>{const version=++request.current;void loadCourse(id,selected).then(r=>{if(request.current===version){setCourse(r.course);setError(false);}}).catch(()=>{if(request.current===version)setError(true);});},[id,selected,authUser?.id]);
 useEffect(()=>{setCourse(null);setError(false);return()=>{request.current++;};},[id,selected,authUser?.id]);
 useFocusEffect(useCallback(()=>{load();return()=>{request.current++;};},[load]));
 useEffect(()=>{const sub=AppState.addEventListener('change',s=>{if(s==='active')load();});return()=>sub.remove();},[load]);
 useEffect(()=>{if(!course?.nextChangeAt)return;const timer=setTimeout(load,Math.min(2147483000,Math.max(100,Date.parse(course.nextChangeAt)-Date.now()+100)));return()=>clearTimeout(timer);},[course,load]);
 const available=course?.state==='available'&&Date.parse(course.accessUntil)>Date.now();
 const dates=course?`${new Date(course.startedAt).toLocaleDateString(locale)} — ${new Date(course.accessUntil).toLocaleDateString(locale)}`:'';
 return <StackScreenLayout><StackScrollView contentOptions={{horizontalPadding:24}}><ScreenHeader title={course?.title||strings.my}/>
 {!course&&!error?<ActivityIndicator color={theme.colors.accent}/>:null}
 {error?<View style={{gap:12}}><AppText tone="danger">{strings.error}</AppText><AppButton label={strings.retry} onPress={()=>load()}/></View>:null}
 {course&&available?<CourseCurrentCard course={course} onLesson={setSelected}/>:course?<View style={{gap:16}}><AppText variant="dialogTitle">{strings.expired}</AppText><AppText>{strings.period}: {dates}</AppText><AppText>{strings.repeat}</AppText></View>:null}
 </StackScrollView><FloatingCloseButton accessibilityLabel={strings.close} onPress={()=>router.back()}/></StackScreenLayout>;
}
