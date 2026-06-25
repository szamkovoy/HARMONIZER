import { Canvas, Circle, Path, Skia } from "@shopify/react-native-skia";
import { StyleSheet, Text, View } from "react-native";

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
  natalProfile?: NatalProfile;
  transitPositions?: Partial<Record<Planet, { longitude?: number; lon?: number }>>;
  aspects?: AstroChartAspect[];
  showHouses?: boolean;
  size: number;
  mode?: "natal_transit" | "transit_only";
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
  sextile: "#22c55e",
  square: "#38bdf8",
  opposition: "#38bdf8",
  conjunction: "#22c55e",
};

function transitLongitude(value: { longitude?: number; lon?: number } | undefined): number | null {
  if (typeof value?.longitude === "number") return value.longitude;
  if (typeof value?.lon === "number") return value.lon;
  return null;
}

function segmentPath(x1: number, y1: number, x2: number, y2: number) {
  const p = Skia.Path.Make();
  p.moveTo(x1, y1);
  p.lineTo(x2, y2);
  return p;
}

export function AstroChartSVG({
  natalProfile,
  transitPositions,
  aspects,
  showHouses = false,
  size,
  mode = "natal_transit",
}: AstroChartSVGProps) {
  const theme = useTheme();
  const cx = size / 2;
  const cy = size / 2;
  const outerRadius = size / 2 - 10;
  const zodiacInnerRadius = outerRadius - 26;
  const transitOnlyRadius = outerRadius - 44;
  const natalRadius = transitPositions ? outerRadius - 68 : outerRadius - 42;
  const transitRadius = mode === "transit_only" ? transitOnlyRadius : outerRadius - 42;
  const houseRadius = natalRadius - 22;

  const lonToAngle = (lon: number) => ((180 - lon) % 360) * (Math.PI / 180);
  const lonToXY = (lon: number, radius: number) => {
    const angle = lonToAngle(lon);
    return {
      x: cx + radius * Math.cos(angle),
      y: cy - radius * Math.sin(angle),
    };
  };

  const border = theme.colors.surfaceBorder;
  const faint = theme.colors.textFaint;
  const primary = theme.colors.textPrimary;
  const warning = theme.colors.warning;

  return (
    <View style={{ width: size, height: size }}>
      <Canvas style={{ width: size, height: size }}>
        <Circle cx={cx} cy={cy} r={outerRadius} color={border} style="stroke" strokeWidth={1.2} />
        <Circle cx={cx} cy={cy} r={zodiacInnerRadius} color={border} style="stroke" strokeWidth={1} />
        {mode === "natal_transit" ? (
          <Circle cx={cx} cy={cy} r={natalRadius - 22} color={border} style="stroke" strokeWidth={0.8} />
        ) : (
          <Circle cx={cx} cy={cy} r={transitOnlyRadius - 18} color={border} style="stroke" strokeWidth={0.8} />
        )}

        {ZODIAC_SIGNS.map((sign, index) => {
          const signStart = index * 30;
          const outer = lonToXY(signStart, outerRadius);
          const inner = lonToXY(signStart, zodiacInnerRadius);
          return (
            <Path
              key={sign.name}
              path={segmentPath(inner.x, inner.y, outer.x, outer.y)}
              style="stroke"
              strokeWidth={1}
              color={border}
            />
          );
        })}

        {mode === "natal_transit" &&
          showHouses &&
          natalProfile?.houseCusps?.map((cusp, index) => {
            const outer = lonToXY(cusp, houseRadius);
            const inner = lonToXY(cusp, 18);
            return (
              <Path
                key={`house-${index}`}
                path={segmentPath(inner.x, inner.y, outer.x, outer.y)}
                style="stroke"
                strokeWidth={index === 0 || index === 6 ? 1.8 : 0.8}
                color={faint}
                opacity={0.7}
              />
            );
          })}

        {aspects?.map((aspect) => {
          const fromLon = transitLongitude(transitPositions?.[aspect.from]);
          const toLon =
            mode === "transit_only"
              ? transitLongitude(transitPositions?.[aspect.to])
              : natalProfile?.planets[aspect.to]?.longitude;
          if (fromLon == null || typeof toLon !== "number") return null;
          const from = lonToXY(fromLon, transitRadius);
          const to = lonToXY(toLon, mode === "transit_only" ? transitRadius : natalRadius);
          const color = ASPECT_COLORS[aspect.type] ?? faint;
          return (
            <Path
              key={`aspect-${aspect.from}-${aspect.to}-${aspect.type}`}
              path={segmentPath(from.x, from.y, to.x, to.y)}
              style="stroke"
              strokeWidth={1.4}
              color={color}
              opacity={0.52}
            />
          );
        })}
      </Canvas>

      <View style={[StyleSheet.absoluteFill, styles.overlay]} pointerEvents="none">
        {ZODIAC_SIGNS.map((sign, index) => {
          const signStart = index * 30;
          const label = lonToXY(signStart + 15, outerRadius - 13);
          return (
            <Text
              key={`z-${sign.name}`}
              style={[styles.zodiacSymbol, { left: label.x - 10, top: label.y - 11, color: sign.color }]}
            >
              {sign.symbol}
            </Text>
          );
        })}

        {mode === "natal_transit" &&
          showHouses &&
          natalProfile?.houseCusps?.map((cusp, index) => {
            const label = lonToXY(cusp + 15, Math.max(30, houseRadius - 16));
            return (
              <Text
                key={`hn-${index}`}
                style={[styles.houseNum, { left: label.x - 7, top: label.y - 8, color: faint }]}
              >
                {index + 1}
              </Text>
            );
          })}

        {mode === "natal_transit" && natalProfile
          ? PLANETS_7.map((planet) => {
              const xy = lonToXY(natalProfile.planets[planet].longitude, natalRadius);
              return (
                <Text
                  key={`n-${planet}`}
                  style={[styles.planetNatal, { left: xy.x - 12, top: xy.y - 14, color: primary }]}
                >
                  {PLANET_SYMBOLS[planet]}
                </Text>
              );
            })
          : null}

        {transitPositions
          ? PLANETS_7.map((planet) => {
              const lon = transitLongitude(transitPositions[planet]);
              if (lon == null) return null;
              const xy = lonToXY(lon, transitRadius);
              return (
                <Text key={`t-${planet}`} style={[styles.planetTransit, { left: xy.x - 10, top: xy.y - 12, color: warning }]}>
                  {PLANET_SYMBOLS[planet]}
                </Text>
              );
            })
          : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  overlay: { alignItems: "flex-start", justifyContent: "flex-start" },
  zodiacSymbol: {
    position: "absolute",
    fontSize: 15,
    textAlign: "center",
    width: 20,
    fontWeight: "500",
  },
  houseNum: {
    position: "absolute",
    fontSize: 10,
    textAlign: "center",
    width: 14,
  },
  planetNatal: {
    position: "absolute",
    fontSize: 20,
    textAlign: "center",
    width: 24,
    fontWeight: "600",
  },
  planetTransit: {
    position: "absolute",
    fontSize: 17,
    textAlign: "center",
    width: 22,
    fontWeight: "600",
  },
});
