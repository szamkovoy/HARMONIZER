import {useCallback} from 'react';
import {Pressable,View} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {router,type Href} from 'expo-router';
import {useAppLocale} from '@/modules/i18n';
import {AppText} from '@/modules/ui/AppText';
import {AppButton} from '@/modules/ui/AppButton';
import {SurfaceCardView} from '@/modules/ui/SurfaceCardView';
import {useTheme} from '@/modules/ui/theme';
import {useCourses,showsOnDay} from './CoursesProvider';
import {CourseCurrentCard} from './CourseContent';
import {courseStrings} from './strings';
export function DayCourseCards(){
 const {courses,refresh}=useCourses();useFocusEffect(useCallback(()=>{void refresh();},[refresh]));
 const visible=courses.filter(c=>showsOnDay(c));if(!visible.length)return null;
 return <View style={{gap:16,marginBottom:16}}>{visible.map(c=><CourseCurrentCard key={c.id} course={c}/>)}</View>;
}
export function MyCoursesCard(){
 const {courses,error,refresh}=useCourses();const {locale}=useAppLocale();const strings=courseStrings(locale);const theme=useTheme();
 useFocusEffect(useCallback(()=>{void refresh();},[refresh]));
 return <SurfaceCardView tone="elevated"><AppText variant="sectionTitle">{strings.my}</AppText>
 {!courses.length?<AppText tone="muted" variant="screenHint">{error?strings.error:strings.empty}</AppText>:null}
 {courses.map(c=><Pressable key={c.id} accessibilityRole="button" onPress={()=>router.push({pathname:'/course/[id]',params:{id:c.id}} as unknown as Href)} style={{paddingVertical:12,borderBottomWidth:1,borderColor:theme.colors.surfaceBorder}}>
 <AppText>{c.title} →</AppText><AppText variant="screenHint" tone="muted">{c.state==='available'?strings.available:strings.expired}</AppText></Pressable>)}
 {error?<AppButton label={strings.retry} variant="secondary" onPress={()=>void refresh()}/>:null}</SurfaceCardView>;
}
