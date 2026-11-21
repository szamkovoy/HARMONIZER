import {Image,View} from 'react-native';
import {Ionicons} from '@expo/vector-icons';
import {useTheme} from '@/modules/ui/theme';

// Use the same disclosure asset as the Day action cards.
const dayChevron=require('@/assets/icons/day_action_chevron.png');
export function CourseRowIcon({kind,tone='primary'}:{kind:'arrow'|'close'|'expanded'|'collapsed';tone?:'primary'|'accent'}){
 const theme=useTheme();const color=tone==='accent'?theme.colors.accent:theme.colors.textPrimary;
 return <View accessible={false} style={{width:14,height:22,alignItems:'flex-start',justifyContent:'center'}}>
 {kind==='expanded'||kind==='collapsed'
  ? <Image source={dayChevron} resizeMode="contain" style={{width:14,height:12,marginTop:3,tintColor:color,transform:[{rotate:kind==='expanded'?'180deg':'0deg'}]}}/>
  : <Ionicons name={kind==='arrow'?'arrow-forward-outline':'close-outline'} size={14} color={color}/>}
 </View>;
}
