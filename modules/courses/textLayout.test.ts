import {describe,expect,it} from 'vitest';
import {courseTextLineHeight} from './textLayout';

describe('iOS TextKit last-line rounding guard',()=>{
 it.each([1,1.15,1.3,1.5,2])('reserves a physical pixel with font scale %s',fontScale=>{
   for(const ratio of [2,3]){
     const height=courseTextLineHeight(22,ratio,fontScale)*fontScale;
     // TextKit rounds unbounded measured height up to the physical pixel grid.
     // Its drawing container can then lose a float ULP at a distant absolute Y.
     for(const lines of [1,2,20,100]){
       const measured=Math.ceil(height*lines*ratio)/ratio;
       const drawn=Math.fround(Math.fround(4096+measured)-4096);
       expect(drawn).toBeGreaterThan(height*lines);
     }
     expect(height-22*fontScale).toBeLessThan(1/ratio+0.002);
   }
 });
 it('keeps the theme line height visually unchanged at default scale',()=>{
   expect(courseTextLineHeight(22,3,1)).toBeCloseTo(22.001,6);
 });
});
