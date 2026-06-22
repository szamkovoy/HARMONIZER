export function polar(cx: number, cy: number, radius: number, angleDeg: number) {
  const radians = ((angleDeg - 90) * Math.PI) / 180;
  return {
    x: cx + radius * Math.cos(radians),
    y: cy + radius * Math.sin(radians),
  };
}

export function donutPath(
  cx: number,
  cy: number,
  outerRadius: number,
  innerRadius: number,
  startAngle: number,
  endAngle: number,
) {
  if (endAngle <= startAngle) return "";
  if (endAngle - startAngle >= 359.999) {
    const outerTop = polar(cx, cy, outerRadius, 0);
    const outerBottom = polar(cx, cy, outerRadius, 180);
    const innerTop = polar(cx, cy, innerRadius, 0);
    const innerBottom = polar(cx, cy, innerRadius, 180);
    return [
      `M ${outerTop.x} ${outerTop.y}`,
      `A ${outerRadius} ${outerRadius} 0 1 1 ${outerBottom.x} ${outerBottom.y}`,
      `A ${outerRadius} ${outerRadius} 0 1 1 ${outerTop.x} ${outerTop.y}`,
      `L ${innerTop.x} ${innerTop.y}`,
      `A ${innerRadius} ${innerRadius} 0 1 0 ${innerBottom.x} ${innerBottom.y}`,
      `A ${innerRadius} ${innerRadius} 0 1 0 ${innerTop.x} ${innerTop.y}`,
      "Z",
    ].join(" ");
  }
  const startOuter = polar(cx, cy, outerRadius, endAngle);
  const endOuter = polar(cx, cy, outerRadius, startAngle);
  const startInner = polar(cx, cy, innerRadius, startAngle);
  const endInner = polar(cx, cy, innerRadius, endAngle);
  const largeArcFlag = endAngle - startAngle > 180 ? 1 : 0;

  return [
    `M ${startOuter.x} ${startOuter.y}`,
    `A ${outerRadius} ${outerRadius} 0 ${largeArcFlag} 0 ${endOuter.x} ${endOuter.y}`,
    `L ${startInner.x} ${startInner.y}`,
    `A ${innerRadius} ${innerRadius} 0 ${largeArcFlag} 1 ${endInner.x} ${endInner.y}`,
    "Z",
  ].join(" ");
}

export function strokeArcPath(cx: number, cy: number, radius: number, sweepDeg: number) {
  const safeSweep = Math.max(0, Math.min(360, sweepDeg));
  if (safeSweep <= 0) return "";
  if (safeSweep >= 359.999) {
    const top = polar(cx, cy, radius, 0);
    const bottom = polar(cx, cy, radius, 180);
    return [
      `M ${top.x} ${top.y}`,
      `A ${radius} ${radius} 0 1 1 ${bottom.x} ${bottom.y}`,
      `A ${radius} ${radius} 0 1 1 ${top.x} ${top.y}`,
    ].join(" ");
  }
  const start = polar(cx, cy, radius, 0);
  const end = polar(cx, cy, radius, safeSweep);
  const largeArcFlag = safeSweep > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArcFlag} 1 ${end.x} ${end.y}`;
}

export function easeOutCubic(value: number) {
  const t = Math.max(0, Math.min(1, value));
  return 1 - (1 - t) ** 3;
}
