import {beforeEach,describe,it,expect,vi} from 'vitest';
const fixture=vi.hoisted(()=>({admin:true,lesson:{id:'lesson',course_slug:'pilot',title:'Old title',blocks:[{type:'text',markdown:'Old text'}],email_step_id:'step'} as Record<string,unknown>,db:vi.fn()}));
vi.mock('../../../../_utils/supabase',()=>({
 requireAdmin:vi.fn(async()=>{if(!fixture.admin)throw Error('Unauthorized');}),
 createServiceSupabase:fixture.db,
 json:(body:unknown,init?:ResponseInit)=>Response.json(body,init),
 errorResponse:()=>Response.json({error:'Unauthorized'},{status:401})
}));
import {GET,PATCH} from './route';
const ctx={params:Promise.resolve({id:'lesson'})};
beforeEach(()=>{
 fixture.admin=true;fixture.lesson={id:'lesson',course_slug:'pilot',title:'Old title',blocks:[{type:'text',markdown:'Old text'}],email_step_id:'step'};
 fixture.db.mockClear().mockImplementation(()=>({from:(table:string)=>{let patch:Record<string,unknown>|null=null;const query={select(){return query;},eq(){return query;},update(value:Record<string,unknown>){patch=value;return query;},async single(){if(patch)Object.assign(fixture.lesson,patch);return{data:table==='courses'?{title:'Pilot',automation_id:'chain'}:fixture.lesson,error:null};},async maybeSingle(){return{data:fixture.lesson,error:null};}};return query;}}));
});
describe('admin lesson API',()=>{
 it('rejects unauthorized reads and writes before creating a service client',async()=>{
  fixture.admin=false;expect((await GET(new Request('https://example.test'),ctx)).status).toBe(401);expect((await PATCH(new Request('https://example.test',{method:'PATCH'}),ctx)).status).toBe(401);expect(fixture.db).not.toHaveBeenCalled();
 });
 it('saves the actual lesson record with ordered blocks, preserving schedule and email linkage',async()=>{
  const blocks=[{type:'video',vimeoId:'https://vimeo.com/123456789'},{type:'text',markdown:'A\n\nB'}];
  const response=await PATCH(new Request('https://example.test',{method:'PATCH',body:JSON.stringify({title:'New title',blocks,gap_days:999,email_step_id:'evil'})}),ctx);expect(response.status).toBe(200);
  const {lesson}=await (await GET(new Request('https://example.test'),ctx)).json();
  expect(lesson.title).toBe('New title');expect(lesson.blocks).toEqual([{type:'video',vimeoId:'123456789'},{type:'text',markdown:'A\n\nB'}]);expect(lesson.email_step_id).toBe('step');expect(lesson.gap_days).toBeUndefined();
 });
 it('does not write invalid blocks',async()=>{
  const response=await PATCH(new Request('https://example.test',{method:'PATCH',body:JSON.stringify({title:'New title',blocks:[{type:'video',vimeoId:'https://evil.test/123456789'}]})}),ctx);
  expect(response.status).toBe(400);expect(fixture.lesson.title).toBe('Old title');
 });
});
