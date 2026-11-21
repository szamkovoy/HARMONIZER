import React from 'react';
import {Linking} from 'react-native';
// @ts-expect-error The installed test renderer ships without declarations.
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
import type {CourseView} from '@shared/courses';
const mock=vi.hoisted(()=>({push:vi.fn(),load:vi.fn(),locale:'ru'}));
vi.mock('react-native',()=>({Platform:{OS:'ios'},PixelRatio:{get:()=>3},useWindowDimensions:()=>({fontScale:1}),StyleSheet:{hairlineWidth:0.5},View:'view',Text:'text',Pressable:'button',Linking:{openURL:vi.fn()}}));
vi.mock('@expo/vector-icons',()=>({Ionicons:'icon'}));
vi.mock('expo-router',()=>({router:{push:mock.push}}));
vi.mock('@react-navigation/native',()=>({useFocusEffect:(cb:()=>void)=>React.useEffect(cb,[cb]),useIsFocused:()=>true}));
vi.mock('@/modules/i18n',()=>({useAppLocale:()=>({locale:mock.locale})}));
vi.mock('@/modules/remote-play',()=>({useRemotePlay:()=>({connected:false})}));
vi.mock('@/modules/practices/core/vimeo',()=>({vimeoAudiotrackForLocale:(locale:string)=>locale==='ru'?'ru':'en'}));
vi.mock('@/modules/practices/ui/PhoneVimeoPlayer',()=>({PhoneVimeoPlayer:'video'}));
vi.mock('@/modules/ui/PracticeKeepAwake',()=>({PracticeKeepAwake:'awake'}));
vi.mock('@/modules/ui/AppText',()=>({AppText:'text'}));
vi.mock('@/modules/ui/AppButton',()=>({AppButton:'action'}));
vi.mock('@/modules/ui/SurfaceCardView',()=>({SurfaceCardView:'card'}));
vi.mock('@/modules/ui/theme',()=>({useTheme:()=>({typography:{screenHint:{lineHeight:22},contentTitle:{lineHeight:22}},surfaceCard:{padding:18,gap:14},colors:{accent:'green',surfaceBorder:'grey',textPrimary:'black'}})}));
vi.mock('./client',()=>({loadCourse:mock.load,CourseRequestError:class extends Error{constructor(public status:number){super();}}}));
vi.mock('./CourseRowIcon',()=>({CourseRowIcon:'course-icon'}));
import {CourseCurrentCard,CourseMarkdown} from './CourseContent';
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const immediateFrame=(cb:()=>void)=>{cb();return 1;};
vi.stubGlobal('requestAnimationFrame',immediateFrame);
const course:CourseView={id:'grant',slug:'pilot',title:'Pilot',mode:'test',startedAt:'2026-11-01T00:00:00Z',accessUntil:'2099-01-01T00:00:00Z',displayUntil:'2098-01-01T00:00:00Z',landingUrl:'',state:'available',current:{id:'last',position:2,title:'Последний',blocks:[{type:'video',vimeoId:'22222222'}]},lessons:[{id:'first',position:1,title:'Первый длинный урок'},{id:'last',position:2,title:'Последний'}],totalLessons:2,nextChangeAt:null};
let view:ReactTestRenderer|undefined;

it('retains the final sentence and clickable address in a long lesson paragraph',async()=>{
 const text='Или - интересная альтернатива - приглашаю вас на практикум, посвященный мужско-женском проявлениям. Тема актуальна практически для каждого, независимо от семейного статуса и возраста. Кому-то нужно гармонизировать настоящее, кому-то прошлое, кому-то и то и другое :) Чтобы ознакомиться с описанием этой программы и записаться, перейдите по ссылке - https://zamkovoi.yoga/mmz/';
 await act(()=>{view=create(React.createElement(CourseMarkdown,{text}));});
 const paragraph=view.root.findByProps({variant:'screenHint'});
 expect(paragraph.props.numberOfLines).toBeUndefined();
 expect(paragraph.props.style.lineHeight).toBeGreaterThan(22);
 expect(JSON.stringify(view.toJSON())).toContain('Чтобы ознакомиться с описанием этой программы и записаться, перейдите по ссылке - ');
 view.root.findByProps({accessibilityRole:'link'}).props.onPress();
 expect(Linking.openURL).toHaveBeenCalledWith('https://zamkovoi.yoga/mmz/');
});
beforeEach(()=>{mock.locale='ru';vi.stubGlobal('requestAnimationFrame',immediateFrame);vi.stubGlobal('cancelAnimationFrame',vi.fn());});
afterEach(async()=>{if(view)await act(()=>view.unmount());view=undefined;vi.clearAllMocks();vi.unstubAllGlobals();});
describe('inline course navigation and completed display window',()=>{
 it('hides intensive navigation and accordion, enabling only test review arrows',async()=>{
  const intensive={...course,kind:'intensive'};
  await act(()=>{view=create(React.createElement(CourseCurrentCard,{course:intensive}));});
  expect(JSON.stringify(view.toJSON())).toContain('День: 2');
  expect(view.root.findAll((n:any)=>n.props.accessibilityState?.expanded!==undefined)).toHaveLength(0);
  expect(view.root.findAllByProps({accessibilityLabel:'Предыдущий урок'})).toHaveLength(0);
  await act(()=>view.update(React.createElement(CourseCurrentCard,{course:{...intensive,reviewAllLessons:true}})));
  expect(view.root.findAllByProps({accessibilityLabel:'Предыдущий урок'})).toHaveLength(1);
  expect(view.root.findAll((n:any)=>n.props.accessibilityState?.expanded!==undefined)).toHaveLength(0);
 });
 it('uses translated intensive copy and existing English video/TV track, keeping other courses Russian',async()=>{
  mock.locale='en';
  const intensive={...course,kind:'intensive',current:{...course.current!,blocksI18n:{en:[{type:'video' as const,vimeoId:'22222222'},{type:'text' as const,markdown:'Advice in English'}]}}};
  await act(()=>{view=create(React.createElement(CourseCurrentCard,{course:intensive}));});
  expect(JSON.stringify(view.toJSON())).toContain('Advice in English');expect(view.root.findByType('video').props.audiotrack).toBe('en');
  await act(async()=>view.root.findByType('action').props.onPress());
  expect(mock.push).toHaveBeenCalledWith(expect.objectContaining({params:expect.objectContaining({audiotrack:'en'})}));
  await act(()=>view.update(React.createElement(CourseCurrentCard,{course})));
  expect(view.root.findByType('video').props.audiotrack).toBe('ru');
 });
 it('shows the last material with a closed list until archive mode starts',async()=>{
  await act(()=>{view=create(React.createElement(CourseCurrentCard,{course}));});
  expect(view.root.findByType('video').props.vimeoId).toBe('22222222');
  expect(view.root.findAll((n:any)=>n.props.accessibilityState?.expanded===false)).toHaveLength(1);
  await act(()=>view.update(React.createElement(CourseCurrentCard,{course,archive:true})));
  expect(view.root.findAllByType('video')).toHaveLength(0);
  expect(view.root.findAll((n:any)=>n.props.accessibilityState?.expanded===true)).toHaveLength(1);
 });
 it('selects a received lesson in the same card, scrolls up, and keeps the accordion label',async()=>{
  vi.stubGlobal('requestAnimationFrame',immediateFrame);const scroll=vi.fn();mock.load.mockResolvedValue({course:{...course,current:{id:'first',position:1,title:'Первый длинный урок',blocks:[{type:'video',vimeoId:'11111111'}]}}});
  await act(()=>{view=create(React.createElement(CourseCurrentCard,{course,onNavigate:scroll}));});
  const label=()=>JSON.stringify(view.toJSON()).match(/Полученные уроки[^}]+/g)?.[0];const before=label();
  const toggle=view.root.find((n:any)=>n.props.accessibilityState?.expanded===false);await act(()=>toggle.props.onPress());
  expect(label()).toBe(before);
  const first=view.root.find((n:any)=>n.props.accessibilityState?.selected===false);await act(async()=>first.props.onPress());
  expect(view.root.findByType('video').props.vimeoId).toBe('11111111');expect(mock.push).not.toHaveBeenCalled();expect(scroll).toHaveBeenCalledOnce();
  expect(view.root.findAllByProps({accessibilityLabel:'Предыдущий урок'})).toHaveLength(0);expect(view.root.findAllByProps({accessibilityLabel:'Следующий урок'})).toHaveLength(1);
 });
});


it('renders the transition to all materials and the archive without Intl.PluralRules (Hermes)',async()=>{
 vi.stubGlobal('Intl',{});
 const first={...course,totalLessons:8,lessons:[course.lessons[0]],current:{...course.current!,id:'first'}};
 await act(()=>{view=create(React.createElement(CourseCurrentCard,{course:first}));});
 expect(JSON.stringify(view.toJSON())).toContain('1 из 8');
 const complete={...course,totalLessons:8,lessons:Array.from({length:8},(_,i)=>({id:i===7?'last':`lesson-${i}`,title:`Урок ${i+1}`,position:i+1}))};
 await act(()=>view.update(React.createElement(CourseCurrentCard,{course:complete})));
 expect(JSON.stringify(view.toJSON())).toContain('8 уроков');
 expect(view.root.findByType('video').props.vimeoId).toBe('22222222');
 await act(()=>view.update(React.createElement(CourseCurrentCard,{course:complete,archive:true})));
 expect(view.root.findAllByType('video')).toHaveLength(0);
 expect(view.root.findAll((n:any)=>typeof n.props.accessibilityState?.selected==='boolean')).toHaveLength(8);
});


it('keeps arrow navigation in place while the selected lesson loads',async()=>{
 let complete!:(value:unknown)=>void;
 mock.load.mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));
 const scroll=vi.fn();const anchor=vi.fn();
 await act(()=>{view=create(React.createElement(CourseCurrentCard,{course,onNavigate:scroll,onBeforeLessonChange:anchor}));});
 await act(()=>view.root.findByProps({accessibilityLabel:'Предыдущий урок'}).props.onPress());
 expect(anchor).toHaveBeenCalledOnce();expect(scroll).not.toHaveBeenCalled();
 await act(async()=>complete({course:{...course,current:{id:'first',title:'Первый',position:1,blocks:[{type:'video',vimeoId:'11111111'}]}}}));
 expect(view.root.findByType('video').props.vimeoId).toBe('11111111');expect(scroll).not.toHaveBeenCalled();
});

it('scrolls from a list only after the asynchronously selected content is ready',async()=>{
 let complete!:(value:unknown)=>void;
 mock.load.mockImplementation(()=>new Promise(resolve=>{complete=resolve;}));
 const scroll=vi.fn();
 await act(()=>{view=create(React.createElement(CourseCurrentCard,{course,archive:true,onNavigate:scroll}));});
 await act(()=>view.root.findAll((n:any)=>n.props.accessibilityState?.selected===false)[0].props.onPress());
 expect(scroll).not.toHaveBeenCalled();
 await act(async()=>complete({course:{...course,current:{id:'first',title:'Первый',position:1,blocks:[{type:'video',vimeoId:'11111111'}]}}}));
 expect(scroll).toHaveBeenCalledOnce();
});
