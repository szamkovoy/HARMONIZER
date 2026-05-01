import Svg, { Circle, G, Line, Text as SvgText } from "react-native-svg";

import { PLANETS_7, type NatalProfile, type Planet } from "@/modules/astro-core";
import type { AspectType } from "@/modules/daily-engine";
import { useTheme } from "@/modules/ui/theme";

export type AstroChartAspect = {
  from: Planet;
  to: Planet;
  type: AspectType | string;
  orb?: number;
};

interface AstroChartSVGProps {
  natalProfile: NatalProfile;
  transitPositions?: Partial<Record<Planet, { longitude?: number; lon?: number }>>;
  aspects?: AstroChartAspect[];
  showHouses: boolean;
  size: number;
}

const ZODIAC_SIGNS = [
  { name: "Aries", symbol: "♈", color: "#ef4444" },
  { name: "Taurus", symbol: "♉", color: "#22c55e" },
  { name: "Gemini", symbol: "♊", color: "#eab308" },
  { name: "Cancer", symbol: "♋", color: "#38bdf8" },
  { name: "Leo", symbol: "♌", color: "#f97316" },
  { name: "Virgo", symbol: "♍", color: "#84cc16" },
  { name: "Libra", symbol: "♎", color: "#60a5fa" },
  { name: "Scorpio", symbol: "♏", color: "#a855f7" },
  { name: "Sagittarius", symbol: "♐", color: "#f59e0b" },
  { name: "Capricorn", symbol: "♑", color: "#64748b" },
  { name: "Aquarius", symbol: "♒", color: "#06b6d4" },
  { name: "Pisces", symbol: "♓", color: "#818cf8" },
];

const PLANET_SYMBOLS: Record<Planet, string> = {
  Sun: "☉",
  Moon: "☽",
  Mercury: "☿",
  Venus: "♀",
  Mars: "♂",
  Jupiter: "♃",
  Saturn: "♄",
};

const ASPECT_COLORS: Record<string, string> = {
  trine: "#22c55e",
  sextile: "#38bdf8",
  square: "#ef4444",
  opposition: "#f97316",
  conjunction: "#94a3b8",
};

function transitLongitude(value: { longitude?: number; lon?: number } | undefined): number | null {
  if (typeof value?.longitude === "number") return value.longitude;
  if (typeof value?.lon === "number") return value.lon;
  return null;
}

export function AstroChartSVG({ natalProfile, transitPositions, aspects, showHouses, size }: AstroChartSVGProps) {
  const theme = useTheme();
  const cx = size / 2;
  const cy = size / 2;
  const outerRadius = size / 2 - 10;
  const zodiacInnerRadius = outerRadius - 26;
  const natalRadius = transitPositions ? outerRadius - 68 : outerRadius - 42;
  const transitRadius = outerRadius - 42;
  const houseRadius = natalRadius - 22;

  const lonToAngle = (lon: number) => ((180 - lon) % 360) * (Math.PI / 180);
  const lonToXY = (lon: number, radius: number) => {
    const angle = lonToAngle(lon);
    return {
      x: cx + radius * Math.cos(angle),
      y: cy - radius * Math.sin(angle),
    };
  };

  return (
    <Svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <Circle cx={cx} cy={cy} r={outerRadius} fill="none" stroke={theme.colors.surfaceBorder} strokeWidth={1.2} />
      <Circle cx={cx} cy={cy} r={zodiacInnerRadius} fill="none" stroke={theme.colors.surfaceBorder} strokeWidth={1} />
      <Circle cx={cx} cy={cy} r={natalRadius - 22} fill="none" stroke={theme.colors.surfaceBorder} strokeWidth={0.8} />

      {ZODIAC_SIGNS.map((sign, index) => {
        const signStart = index * 30;
        const outer = lonToXY(signStart, outerRadius);
        const inner = lonToXY(signStart, zodiacInnerRadius);
        const label = lonToXY(signStart + 15, outerRadius - 13);
        return (
          <G key={sign.name}>
            <Line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} stroke={theme.colors.surfaceBorder} />
            <SvgText x={label.x} y={label.y} fontSize={15} textAnchor="middle" alignmentBaseline="middle" fill={sign.color}>
              {sign.symbol}
            </SvgText>
          </G>
        );
      })}

      {showHouses && natalProfile.houseCusps?.map((cusp, index) => {
        const outer = lonToXY(cusp, houseRadius);
        const inner = lonToXY(cusp, 18);
        const label = lonToXY(cusp + 15, Math.max(30, houseRadius - 16));
        return (
          <G key={`house-${index}`}>
            <Line
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
              stroke={theme.colors.textFaint}
              strokeWidth={index === 0 || index === 6 ? 1.8 : 0.8}
              strokeOpacity={0.7}
            />
            <SvgText x={label.x} y={label.y} fontSize={10} textAnchor="middle" alignmentBaseline="middle" fill={theme.colors.textFaint}>
              {index + 1}
            </SvgText>
          </G>
        );
      })}

      {aspects?.map((aspect) => {
        const natalLon = natalProfile.planets[aspect.to]?.longitude;
        const transitLon = transitLongitude(transitPositions?.[aspect.from]);
        if (typeof natalLon !== "number" || transitLon == null) return null;
        const from = lonToXY(transitLon, transitRadius);
        const to = lonToXY(natalLon, natalRadius);
        const color = ASPECT_COLORS[aspect.type] ?? theme.colors.textFaint;
        return (
          <Line
            key={`aspect-${aspect.from}-${aspect.to}-${aspect.type}`}
            x1={from.x}
            y1={from.y}
            x2={to.x}
            y2={to.y}
            stroke={color}
            strokeOpacity={0.52}
            strokeWidth={1.4}
            strokeDasharray={aspect.type === "square" || aspect.type === "opposition" ? "4 3" : undefined}
          />
        );
      })}

      {PLANETS_7.map((planet) => {
        const xy = lonToXY(natalProfile.planets[planet].longitude, natalRadius);
        return (
          <SvgText
            key={`natal-${planet}`}
            x={xy.x}
            y={xy.y}
            fontSize={20}
            textAnchor="middle"
            alignmentBaseline="middle"
            fill={theme.colors.textPrimary}
          >
            {PLANET_SYMBOLS[planet]}
          </SvgText>
        );
      })}

      {transitPositions
        ? PLANETS_7.map((planet) => {
            const lon = transitLongitude(transitPositions[planet]);
            if (lon == null) return null;
            const xy = lonToXY(lon, transitRadius);
            return (
              <SvgText
                key={`transit-${planet}`}
                x={xy.x}
                y={xy.y}
                fontSize={17}
                textAnchor="middle"
                alignmentBaseline="middle"
                fill={theme.colors.warning}
              >
                {PLANET_SYMBOLS[planet]}
              </SvgText>
            );
          })
        : null}
    </Svg>
  );
}
