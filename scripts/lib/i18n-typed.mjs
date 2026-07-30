import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  cpSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";

/** Extract `key: "value"` and one-level nested string objects from a TS const block. */
export function extractStringTree(sourceText, startMarker, endMarker) {
  const start = sourceText.indexOf(startMarker);
  if (start < 0) return null;
  const blockStart = sourceText.indexOf("{", start);
  const end =
    endMarker && sourceText.indexOf(endMarker, blockStart) >= 0
      ? sourceText.indexOf(endMarker, blockStart)
      : sourceText.length;
  const block = sourceText.slice(blockStart, end);

  const flat = {};
  const stack = [{ prefix: "" }];
  /** Brace depth inside `=> { ... }` bodies — avoids mistaking `},` for object close. */
  let fnBodyDepth = 0;

  const lines = block.split("\n");
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed === "{") continue;

    if (fnBodyDepth > 0) {
      const opens = (line.match(/\{/g) ?? []).length;
      const closes = (line.match(/\}/g) ?? []).length;
      fnBodyDepth += opens - closes;
      if (fnBodyDepth <= 0) fnBodyDepth = 0;
      continue;
    }

    if (/=>\s*\{/.test(trimmed)) {
      const opens = (line.match(/\{/g) ?? []).length;
      const closes = (line.match(/\}/g) ?? []).length;
      fnBodyDepth = Math.max(opens - closes, 1);
      continue;
    }

    const nestedStart = trimmed.match(/^("([^"]+)"|(\w+)):\s*\{/);
    if (nestedStart) {
      const parent = stack[stack.length - 1];
      const segment = nestedStart[2] ?? nestedStart[3];
      stack.push({
        prefix: parent.prefix ? `${parent.prefix}.${segment}` : segment,
      });
      continue;
    }
    if (trimmed === "}," || trimmed === "}" || trimmed === "};") {
      if (stack.length > 1) stack.pop();
      continue;
    }

    const inlineKeyMatch = trimmed.match(/^("([^"]+)"|(\w+)):\s*"((?:\\.|[^"\\])*)"\s*,?\s*$/);
    if (inlineKeyMatch) {
      const parent = stack[stack.length - 1];
      const segment = inlineKeyMatch[2] ?? inlineKeyMatch[3];
      const key = parent.prefix ? `${parent.prefix}.${segment}` : segment;
      flat[key] = inlineKeyMatch[4].replace(/\\"/g, '"');
      continue;
    }

    const keyOnlyMatch = trimmed.match(/^("([^"]+)"|(\w+)):\s*,?\s*$/);
    if (keyOnlyMatch) {
      for (let j = lineIndex + 1; j < lines.length; j += 1) {
        const next = lines[j].trim();
        if (!next || next.startsWith("//")) continue;
        const valueMatch = next.match(/^"((?:\\.|[^"\\])*)"\s*,?\s*$/);
        if (valueMatch) {
          const parent = stack[stack.length - 1];
          const segment = keyOnlyMatch[2] ?? keyOnlyMatch[3];
          const key = parent.prefix ? `${parent.prefix}.${segment}` : segment;
          flat[key] = valueMatch[1].replace(/\\"/g, '"');
        }
        break;
      }
    }
  }

  return flat;
}

export function unflatten(flat) {
  const root = {};
  for (const [path, value] of Object.entries(flat)) {
    const parts = path.split(".");
    let cursor = root;
    for (let i = 0; i < parts.length - 1; i += 1) {
      cursor[parts[i]] = cursor[parts[i]] ?? {};
      cursor = cursor[parts[i]];
    }
    cursor[parts[parts.length - 1]] = value;
  }
  return root;
}

export function flatten(obj, prefix = "") {
  const out = {};
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(out, flatten(value, path));
    } else if (typeof value === "string") {
      out[path] = value;
    }
  }
  return out;
}

export function readTypedManifest(repoRoot) {
  const path = join(repoRoot, "modules/i18n/typed/manifest.json");
  return JSON.parse(readFileSync(path, "utf8"));
}

export function typedCatalogDir(repoRoot, moduleId) {
  return join(repoRoot, "modules/i18n/typed/catalog", moduleId);
}

export function extractModuleSource(repoRoot, entry) {
  if (entry.source === "json") {
    const path = join(repoRoot, entry.file);
    return flatten(JSON.parse(readFileSync(path, "utf8")));
  }
  const text = readFileSync(join(repoRoot, entry.file), "utf8");
  return extractStringTree(text, entry.start, entry.end);
}

export function writeGeneratedRegistry(repoRoot, manifest) {
  const imports = [];
  const registryEntries = [];

  for (const entry of manifest) {
    const dir = typedCatalogDir(repoRoot, entry.id);
    if (!existsSync(dir)) continue;
    const locales = [];
    for (const file of readdirSync(dir)) {
      if (!file.endsWith(".json")) continue;
      const locale = file.replace(/\.json$/, "");
      const varName = `${entry.id}_${locale}`.replace(/[^a-zA-Z0-9_]/g, "_");
      imports.push(`import ${varName} from "./catalog/${entry.id}/${locale}.json";`);
      locales.push(`    ${locale}: ${varName} as Record<string, unknown>,`);
    }
    if (locales.length) {
      registryEntries.push(`  ${entry.id}: {\n${locales.join("\n")}\n  },`);
    }
  }

  const content = `/** AUTO-GENERATED by scripts/i18n-sync.mjs — do not edit by hand. */
${imports.join("\n")}

export const GENERATED_TYPED_OVERLAYS: Record<
  string,
  Partial<Record<string, Record<string, unknown>>>
> = {
${registryEntries.join("\n")}
};
`;
  writeFileSync(join(repoRoot, "modules/i18n/typed/generated-overlays.ts"), content, "utf8");
  // Vercel builds from `_legacy_web/` — keep its typed overlays in lockstep with the Expo tree.
  mirrorTypedOverlaysToLegacy(repoRoot);
}

/** Copy `modules/i18n/typed/{catalog,generated-overlays,manifest,.sync-meta}` → `_legacy_web/...`. */
export function mirrorTypedOverlaysToLegacy(repoRoot) {
  const src = join(repoRoot, "modules/i18n/typed");
  const dest = join(repoRoot, "_legacy_web/modules/i18n/typed");
  if (!existsSync(src) || !existsSync(join(repoRoot, "_legacy_web"))) return;

  mkdirSync(dest, { recursive: true });
  const catalogSrc = join(src, "catalog");
  const catalogDest = join(dest, "catalog");
  if (existsSync(catalogDest)) {
    rmSync(catalogDest, { recursive: true, force: true });
  }
  if (existsSync(catalogSrc)) {
    cpSync(catalogSrc, catalogDest, { recursive: true });
  }
  for (const name of ["generated-overlays.ts", "manifest.json", ".sync-meta.json", "merge.ts"]) {
    const from = join(src, name);
    if (existsSync(from)) {
      cpSync(from, join(dest, name));
    }
  }
}

export function ensureCatalogDir(repoRoot, moduleId) {
  const dir = typedCatalogDir(repoRoot, moduleId);
  mkdirSync(dir, { recursive: true });
  return dir;
}

export function writeJson(path, value) {
  const ordered = Object.fromEntries(Object.keys(value).sort().map((k) => [k, value[k]]));
  writeFileSync(path, `${JSON.stringify(ordered, null, 2)}\n`, "utf8");
}
