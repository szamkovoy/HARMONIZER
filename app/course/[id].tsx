import {useCallback,useRef,useState} from 'react';
import {ActivityIndicator,ScrollView,View} from 'react-native';
import {router,useLocalSearchParams} from 'expo-router';
import {useFocusEffect} from '@react-navigation/native';
import {useAppLocale} from '@/modules/i18n';
import {useCourses} from '@/modules/courses/CoursesProvider';
import {isCourseArchive} from '@/modules/courses/state';
import {courseStrings} from '@/modules/courses/strings';
import {CourseCurrentCard} from '@/modules/courses/CourseContent';
import {AppText} from '@/modules/ui/AppText';
import {AppButton} from '@/modules/ui/AppButton';
import {FullScreenModalScaffold} from '@/modules/ui/FullScreenModalScaffold';
import {useTheme} from '@/modules/ui/theme';
export default function CourseScreen(){
 const {id}=useLocalSearchParams<{id:string}>();const {locale}=useAppLocale();const strings=courseStrings(locale);const theme=useTheme();
 const {courses,error,loading,refresh,fromCache}=useCourses();const scroll=useRef<ScrollView>(null);const [viewportHeight,setViewportHeight]=useState(0);const [anchored,setAnchored]=useState(false);
 useFocusEffect(useCallback(()=>{void refresh();},[refresh]));
 const course=courses.find(c=>c.id===id);
 const available=course?.state==='available'&&Date.parse(course.accessUntil)>Date.now();
 const dates=course?`${new Date(course.startedAt).toLocaleDateString(locale)} — ${new Date(course.accessUntil).toLocaleDateString(locale)}`:'';
 return <FullScreenModalScaffold title={course?.title||strings.my} closeLabel={strings.close} onClose={()=>router.back()}>
 <ScrollView ref={scroll} onLayout={event=>setViewportHeight(event.nativeEvent.layout.height)} contentContainerStyle={{padding:18,paddingBottom:40,gap:16}}>
 {!course&&loading?<ActivityIndicator color={theme.colors.accent}/>:null}
 {error?<View style={{gap:12}}><AppText tone="danger">{strings.error}</AppText><AppButton label={strings.retry} onPress={()=>void refresh()}/></View>:null}
 {course&&available?<View style={anchored?{minHeight:viewportHeight}:undefined}><CourseCurrentCard course={course} archive={isCourseArchive(course)} showCourseTitle={false} fromCache={fromCache} onBeforeLessonChange={()=>setAnchored(true)} onRetry={()=>void refresh()} onNavigate={()=>scroll.current?.scrollTo({y:0,animated:true})}/></View>:course?<View style={{gap:16}}><AppText variant="dialogTitle">{strings.expired}</AppText><AppText>{strings.period}: {dates}</AppText><AppText>{strings.repeat}</AppText></View>:!loading&&!error?<AppText>{strings.unavailable}</AppText>:null}
 </ScrollView></FullScreenModalScaffold>;
}
