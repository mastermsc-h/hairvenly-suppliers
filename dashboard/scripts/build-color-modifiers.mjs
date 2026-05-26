/**
 * Compound-Modifier-Detection v2 — checkt name_hairvenly UND name_shopify
 * mit Method-Suffix-Filtering. Wir wollen NUR Farb-Modifier, keine Produkttyp-Modifier.
 */
import pg from "pg";
const { Client } = pg;
const c = new Client({ connectionString: "postgresql://postgres.xzisnlkqiomvmbslwhvg:yPa1PNWr0KozQlPP@aws-1-eu-central-1.pooler.supabase.com:5432/postgres" });
await c.connect();

// Noise: methodische/strukturelle Tokens, die aus den Shopify-Namen rausfliegen müssen
const METHOD_NOISE = new Set([
  "tape","tapes","bonding","bondings","weft","wefts","clip","clips","tressen","tresse","extension","extensions",
  "russisch","russische","russischen","russischer","russisches","ru",
  "usbekisch","usbekische","usbekischer","usbekisches","us",
  "wellige","welliges","wellig","glatt","glatte","glatten","glattes",
  "standard","mini","genius","classic","invisible","butterfly",
  "echthaar","echte","haar","haare","premium","luxury","keratin",
  "ponytail","ponytails",
  // Reine Farbdeskriptoren (NICHT branded modifier)
  "braune","brauner","braun","schwarz","schwarze","schwarzer","schwarzbraun","schwarzbraune",
  "dunkelbraun","dunkelbraune","hellbraun","hellbraune","mittelbraun","mittelbraune","mittelaschbraun",
  "blond","blonde","blonder","dunkelblond","hellblond","mittelblond","lichtblond","platinblond","honigblond",
  "ash","asch","aschblond","aschblonde",
  "balayage","ombre","ombré","ombres","solide","highlight","highlights","strähnchen","gesträhntes","gestraehntes",
  "kühles","kuhles","kühl","hell","dunkel","mittel","tiefschwarz","tief",
  "gold","kupfer","rot","rote",
  "♡","♥","|","–","-","#","(",")","als",
]);

const isNoise = (t) => {
  const tl = t.toLowerCase();
  if (METHOD_NOISE.has(tl)) return true;
  if (/^\d+(cm|g|gr|gramm)?$/i.test(t)) return true;
  return false;
};

const tokenize = (s) => s
  .toUpperCase()
  .replace(/[#♡♥|()\[\]–]/g, " ")
  .split(/[\s\-_/,]+/)
  .filter(Boolean);

// Extrahiere "Farb-Identität" aus einem Produktnamen: Tokens VOR dem ersten Noise-Token
const extractColorIdentity = (s) => {
  const toks = tokenize(s);
  const result = [];
  for (const t of toks) {
    if (isNoise(t)) break;
    result.push(t.toLowerCase());
  }
  return result;
};

// Lade beide Quellen
const r1 = await c.query(`SELECT DISTINCT TRIM(name_hairvenly) AS c FROM product_colors WHERE name_hairvenly IS NOT NULL AND TRIM(name_hairvenly) != ''`);
const r2 = await c.query(`SELECT DISTINCT TRIM(name_shopify) AS c FROM product_colors WHERE name_shopify IS NOT NULL AND TRIM(name_shopify) != ''`);

const allNames = [...r1.rows.map(x => x.c), ...r2.rows.map(x => x.c)];

// Sammle alle eindeutigen Color-Identities (Token-Tupel)
const identitiesByKey = new Map(); // sorted-tokens-key → first original
for (const name of allNames) {
  const id = extractColorIdentity(name);
  if (id.length === 0) continue;
  const key = id.join(" ");
  if (!identitiesByKey.has(key)) identitiesByKey.set(key, []);
  identitiesByKey.get(key).push(name);
}

const identityKeys = [...identitiesByKey.keys()];
console.log(`Unique Color-Identities: ${identityKeys.length}`);

// Compound-Detection: identity X (multi-token) wo ein Suffix-Sub-Identity auch existiert
const modifiers = new Set();
const compoundPairs = [];
for (const key of identityKeys) {
  const toks = key.split(" ").filter(Boolean);
  if (toks.length < 2) continue;
  for (let splitAt = 1; splitAt < toks.length; splitAt++) {
    const left = toks.slice(0, splitAt).join(" ");
    const right = toks.slice(splitAt).join(" ");
    if (identityKeys.includes(right)) {
      modifiers.add(left.toLowerCase());
      compoundPairs.push({ full: key, modifier: left, base: right, examples: identitiesByKey.get(key).slice(0,2) });
    }
  }
}

console.log(`\n=== ${modifiers.size} Modifier-Tokens: ${[...modifiers].sort().join(", ")} ===\n`);
console.log(`=== ${compoundPairs.length} Compound-Color-Paare: ===`);
for (const p of compoundPairs.slice(0, 50)) {
  console.log(`  "${p.full}" = "${p.modifier}" + "${p.base}"  (z.B. ${p.examples[0]})`);
}

await c.end();
