import {afterEach,describe,it,expect,vi} from 'vitest';
const log=vi.hoisted(()=>vi.fn());
vi.mock('@/services/supabase',()=>({getSupabaseAccessToken:async()=>'PRIVATE_TOKEN'}));
vi.mock('@/services/communicatorConfig',()=>({getCommunicatorApiBaseUrl:()=> 'https://api.example.test'}));
vi.mock('@/services/runtimeDiagnostics',()=>({logRuntimeEvent:log}));
import {loadCourses,loadCourse} from './client';
afterEach(()=>{vi.unstubAllGlobals();vi.useRealTimers();vi.clearAllMocks();});
describe('course API recovery',()=>{
 it('retries a transient gateway error and then returns fresh results',async()=>{
  vi.useFakeTimers();const fetch=vi.fn().mockResolvedValueOnce(new Response('',{status:503})).mockResolvedValueOnce(Response.json({courses:[]}));vi.stubGlobal('fetch',fetch);
  const request=loadCourses();await vi.runAllTimersAsync();expect(await request).toEqual({courses:[]});expect(fetch).toHaveBeenCalledTimes(2);expect(log).not.toHaveBeenCalled();
 });
 it('does not retry a missing lesson and records only non-sensitive error details',async()=>{
  const fetch=vi.fn().mockResolvedValue(new Response('',{status:404}));vi.stubGlobal('fetch',fetch);
  await expect(loadCourse('private-grant','future')).rejects.toMatchObject({status:404});expect(fetch).toHaveBeenCalledOnce();expect(JSON.stringify(log.mock.calls)).not.toMatch(/PRIVATE_TOKEN|private-grant|future/);
 });
});
