import React from 'react';
// @ts-expect-error The installed test renderer ships without declarations.
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {afterEach,describe,it,expect,vi} from 'vitest';
import type {CourseView} from '@shared/courses';
const mock=vi.hoisted(()=>({push:vi.fn(),load:vi.fn()}));
vi.mock('react-native',()=>({View:'view',Text:'text',Pressable:'button',Linking:{openURL:vi.fn()}}));
vi.mock('@expo/vector-icons',()=>({Ionicons:'icon'}));
vi.mock('expo-router',()=>({router:{push:mock.push}}));
vi.mock('@react-navigation/native',()=>({useFocusEffect:(cb:()=>void)=>React.useEffect(cb,[cb]),useIsFocused:()=>true}));
vi.mock('@/modules/i18n',()=>({useAppLocale:()=>({locale:'ru'})}));
vi.mock('@/modules/remote-play',()=>({useRemotePlay:()=>({connected:false})}));
vi.mock('@/modules/practices/core/vimeo',()=>({vimeoAudiotrackForLocale:()=> 'ru'}));
vi.mock('@/modules/practices/ui/PhoneVimeoPlayer',()=>({PhoneVimeoPlayer:'video'}));
vi.mock('@/modules/ui/PracticeKeepAwake',()=>({PracticeKeepAwake:'awake'}));
vi.mock('@/modules/ui/AppText',()=>({AppText:'text'}));
vi.mock('@/modules/ui/AppButton',()=>({AppButton:'action'}));
vi.mock('@/modules/ui/SurfaceCardView',()=>({SurfaceCardView:'card'}));
vi.mock('@/modules/ui/theme',()=>({useTheme:()=>({colors:{accent:'green',surfaceBorder:'grey',textPrimary:'black'}})}));
vi.mock('./client',()=>({loadCourse:mock.load,CourseRequestError:class extends Error{constructor(public status:number){super();}}}));
import {CourseCurrentCard} from './CourseContent';
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
vi.stubGlobal('requestAnimationFrame',(cb:()=>void)=>{cb();return 1;});
const course:CourseView={id:'grant',slug:'pilot',title:'Pilot',mode:'test',startedAt:'2026-11-01T00:00:00Z',accessUntil:'2099-01-01T00:00:00Z',displayUntil:'2098-01-01T00:00:00Z',landingUrl:'',state:'available',current:{id:'last',position:2,title:'Последний',blocks:[{type:'video',vimeoId:'22222222'}]},lessons:[{id:'first',position:1,title:'Первый длинный урок'},{id:'last',position:2,title:'Последний'}],totalLessons:2,nextChangeAt:null};
let view:ReactTestRenderer|undefined;
afterEach(async()=>{if(view)await act(()=>view.unmount());view=undefined;vi.clearAllMocks();});
describe('inline course navigation and completed display window',()=>{
 it('shows the last material with a closed list until archive mode starts',async()=>{
  await act(()=>{view=create(React.createElement(CourseCurrentCard,{course}));});
  expect(view.root.findByType('video').props.vimeoId).toBe('22222222');
  expect(view.root.findAll((n:any)=>n.props.accessibilityState?.expanded===false)).toHaveLength(1);
  await act(()=>view.update(React.createElement(CourseCurrentCard,{course,archive:true})));
  expect(view.root.findAllByType('video')).toHaveLength(0);
  expect(view.root.findAll((n:any)=>n.props.accessibilityState?.expanded===true)).toHaveLength(1);
 });
 it('selects a received lesson in the same card, scrolls up, and keeps the accordion label',async()=>{
  const scroll=vi.fn();mock.load.mockResolvedValue({course:{...course,current:{id:'first',position:1,title:'Первый длинный урок',blocks:[{type:'video',vimeoId:'11111111'}]}}});
  await act(()=>{view=create(React.createElement(CourseCurrentCard,{course,onNavigate:scroll}));});
  const label=()=>JSON.stringify(view.toJSON()).match(/Полученные уроки[^}]+/g)?.[0];const before=label();
  const toggle=view.root.find((n:any)=>n.props.accessibilityState?.expanded===false);await act(()=>toggle.props.onPress());
  expect(label()).toBe(before);
  const first=view.root.find((n:any)=>n.props.accessibilityState?.selected===false);await act(async()=>first.props.onPress());
  expect(view.root.findByType('video').props.vimeoId).toBe('11111111');expect(mock.push).not.toHaveBeenCalled();expect(scroll).toHaveBeenCalledOnce();
  expect(view.root.findAllByProps({accessibilityLabel:'Предыдущий урок'})).toHaveLength(0);expect(view.root.findAllByProps({accessibilityLabel:'Следующий урок'})).toHaveLength(1);
 });
});
