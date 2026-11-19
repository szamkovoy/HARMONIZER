/**
 * RN 0.81 iOS/TextKit can clip the last line when Yoga rounds absolute Y edges
 * separately (e.g. at 2048pt on a 3x screen). A sub-pixel line-height remainder
 * makes TextKit's unbounded measurement reserve one physical pixel of slack.
 * Keep it local to lesson paragraphs; retain theme sizing and Dynamic Type.
 * https://github.com/react/react-native/issues/58970
 */
export function courseTextLineHeight(lineHeight:number,pixelRatio:number,fontScale:number):number {
  return (Math.ceil(lineHeight*fontScale*pixelRatio-1e-6)/pixelRatio+0.001)/fontScale;
}
