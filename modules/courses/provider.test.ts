import React from 'react';
// @ts-expect-error The installed test renderer ships without declarations.
import {act,create,type ReactTestRenderer} from 'react-test-renderer';
import {afterEach,describe,it,expect,vi} from 'vitest';
import type {CourseView} from '@shared/courses';
const mock=vi.hoisted(()=>({uid:'owner',load:vi.fn(),read:vi.fn(),save:vi.fn(),listeners:new Set<(state:string)=>void>()}));
vi.mock('react-native',()=>({AppState:{currentState:'active',addEventListener:(_event:string,listener:(state:string)=>void)=>{mock.listeners.add(listener);return{remove:()=>mock.listeners.delete(listener)};}}}));
vi.mock('@/modules/auth',()=>({useAuth:()=>({authUser:{id:mock.uid}})}));
vi.mock('./client',()=>({loadCourses:mock.load}));
vi.mock('./cache',()=>({readCourseCache:mock.read,saveCourseCache:mock.save}));
import {CoursesProvider,useCourses} from './CoursesProvider';
(globalThis as typeof globalThis&{IS_REACT_ACT_ENVIRONMENT:boolean}).IS_REACT_ACT_ENVIRONMENT=true;
const course={id:'grant',title:'Pilot',current:{id:'first',blocks:[]},lessons:[],nextChangeAt:null} as unknown as CourseView;
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return{resolve,promise};}
let latest:ReturnType<typeof useCourses>;let renderer:ReactTestRenderer|undefined;
function Probe(){latest=useCourses();return null;}
const tree=()=>React.createElement(CoursesProvider,null,React.createElement(Probe));
afterEach(async()=>{if(renderer)await act(()=>renderer?.unmount());renderer=undefined;vi.clearAllMocks();mock.listeners.clear();mock.uid='owner';});
describe('course recovery without losing access UI',()=>{
 it('restores metadata during a cold-start network failure and keeps it on another failed refresh',async()=>{
  mock.read.mockResolvedValue([course]);mock.load.mockRejectedValue(new Error('offline'));mock.save.mockResolvedValue(undefined);
  await act(async()=>{renderer=create(tree());});
  expect(latest!.courses[0].id).toBe('grant');expect(latest!.fromCache).toBe(true);expect(latest!.error).toBe(true);
  await act(async()=>{await latest!.refresh();});expect(latest!.courses).toHaveLength(1);
 });
 it('never replaces fresh results with a late stale cache',async()=>{
  const cache=deferred<CourseView[]>();mock.read.mockReturnValue(cache.promise);mock.load.mockResolvedValue({courses:[]});
  await act(async()=>{renderer=create(tree());});await act(async()=>cache.resolve([course]));
  expect(latest!.courses).toEqual([]);expect(latest!.fromCache).toBe(false);
 });
 it('does not expose the previous account while the next account is loading',async()=>{
  mock.read.mockResolvedValue(null);mock.load.mockResolvedValue({courses:[course]});await act(async()=>{renderer=create(tree());});expect(latest!.courses).toHaveLength(1);
  const network=deferred<{courses:CourseView[]}>();mock.uid='another';mock.load.mockReturnValue(network.promise);
  await act(async()=>renderer!.update(tree()));expect(latest!.courses).toEqual([]);
  await act(async()=>network.resolve({courses:[]}));expect(latest!.courses).toEqual([]);
 });
});
