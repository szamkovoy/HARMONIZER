import {beforeEach,describe,it,expect,vi} from 'vitest';
const mock=vi.hoisted(()=>({admin:true,rpc:vi.fn(),client:vi.fn()}));
vi.mock('../../../_utils/supabase',()=>({requireAdmin:async()=>{if(!mock.admin)throw Error('Unauthorized');},createServiceSupabase:mock.client,json:(data:unknown,init?:ResponseInit)=>Response.json(data,init),errorResponse:()=>Response.json({error:'Unauthorized'},{status:401})}));
vi.mock('../../../_utils/courseService',()=>({startPreparedCourse:vi.fn()}));
import {POST} from './route';
beforeEach(()=>{
 vi.clearAllMocks();mock.admin=true;mock.rpc.mockResolvedValue({data:'prepared-id',error:null});
 mock.client.mockImplementation(()=>({rpc:mock.rpc,from(table:string){const q={select(){return q;},eq(){return q;},single(){return Promise.resolve({data:table==='users'?{tz:'Europe/Berlin'}:{user_id:'owner'},error:null});}};return q;}}));
});
describe('preparing a test for another course',()=>{
 it.each([['next-practicum','next-practicum'],[undefined,'month-health']])('uses courseSlug %s without starting delivery',async(courseSlug,expected)=>{
  const response=await POST(new Request('https://example.test',{method:'POST',body:JSON.stringify({action:'prepare',email:'owner@example.test',courseSlug})}));
  expect(await response.json()).toMatchObject({status:'prepared',started:false});
  expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('prepare_course_test',{p_user_id:'owner',p_slug:expected,p_timezone:'Europe/Berlin'});
 });
 it('rejects non-admin access',async()=>{mock.admin=false;expect((await POST(new Request('https://example.test',{method:'POST',body:'{}'}))).status).toBe(401);expect(mock.rpc).not.toHaveBeenCalled();});
});
