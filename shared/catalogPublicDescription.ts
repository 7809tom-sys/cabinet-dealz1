/**
 * Customer-safe catalog copy helpers.
 *
 * Supplier descriptions and master descriptions are source records. They may
 * include a printed dimension block and/or a trailing book, page, import, or
 * proof citation. These functions derive presentation-only copy; callers must
 * continue to retain the original values for catalog administration and
 * provenance.
 */

export type PublicCatalogCopy = {
  /** Compact product name for headings, cart lines, and Product.name. */
  title: string;
  /** Source-free, dimension-aware text for public descriptions and JSON-LD. */
  description: string;
};

const DIMENSION_VALUE = String.raw`\d+(?:\.\d+)?(?:\s*(?:-|\s)\s*\d+\/\d+)?`;
const INCH_UNIT = String.raw`\s*(?:["″]|in(?:ches)?\.?)?\s*`;
const DIMENSION_SEPARATOR = String.raw`\s*(?:(?:[×xX,;/])|by)?\s*`;
const AXIS_DIMENSIONS = String.raw`(${DIMENSION_VALUE})${INCH_UNIT}(?:W(?:idth)?)\.?${DIMENSION_SEPARATOR}(${DIMENSION_VALUE})${INCH_UNIT}(?:H(?:eight)?)\.?${DIMENSION_SEPARATOR}(${DIMENSION_VALUE})${INCH_UNIT}(?:D(?:epth)?)\.?`;
const BARE_DIMENSIONS = String.raw`(${DIMENSION_VALUE})${INCH_UNIT}\s*[×xX]\s*(${DIMENSION_VALUE})${INCH_UNIT}\s*[×xX]\s*(${DIMENSION_VALUE})${INCH_UNIT}`;

const AXIS_DIMENSION_BLOCK = new RegExp(AXIS_DIMENSIONS, "i");
const BARE_DIMENSION_BLOCK = new RegExp(BARE_DIMENSIONS, "i");

/**
 * A supplier name by itself is not provenance. Strip it only when the trailing
 * clause also carries a known citation/import/proof marker. That protects valid
 * names such as "AltaEuro-compatible pull-out" from accidental removal.
 */
const SUPPLIER_PROVENANCE_SUFFIX = /(?:^|\s*[.;,]\s*|\s+)(?:source\s*:\s*)?(?:AltaEuro(?:\s*\/\s*U\.?S\.?\s*Cabinet\s*Depot)?|U\.?S\.?\s*Cabinet\s*Depot)(?=[\s\S]*(?:\bfull\s+spec\s+book\b|\bspec(?:ification)?\s+(?:book|sheet)\b|\b(?:v|version)\s*\d+(?:\.\d+)+\b|\b(?:p|pp|page)\.?\s*\d+\b|\b(?:complete[\s-]+line|catalog)\s+import\b|\b(?:source|designer)\s+proof\b))[\s\S]*$/i;
const BOOK_OR_IMPORT_PROVENANCE_SUFFIX = /(?:^|\s*[.;,]\s*|\s+)(?:(?:source\s*:\s*)?(?:(?:full\s+)?spec(?:ification)?\s+book|source\s+(?:book|specification))|(?:complete[\s-]+line|catalog|source)\s+import)(?:[\s,.:–—-][\s\S]*)?$/i;
const SOURCE_PAGE_SUFFIX = /\s*[;,]?\s*source\s+(?:p(?:age)?\.?|pp\.?)\s*\d+(?:\s*[–-]\s*\d+)?\.?\s*$/i;
const INTERNAL_PROOF_SUFFIX = /(?:\s*[.;,]\s*|\s+)(?:staged(?:\s+catalog)?|pending\s+(?:designer\s+)?proof|(?:source|designer)\s+proof|exact\s+distributor\s+source\s+configuration)(?:[.;,\s][\s\S]*)?$/i;

/**
 * "Looks like W1230 in Hickory" is an internal cross-reference note, never customer copy.
 * Everything from "looks like" to the end of the description is removed.
 */
const LOOKS_LIKE_TAIL = /(?:^|\s*[.;,–—|]\s*|\s+)looks?\s+like\b[\s\S]*$/i;
/**
 * A supplier or distributor name as the LAST thing in a description ("... , U.S. Cabinet Depot",
 * "... from AEF") is attribution, not product wording. Only a trailing, separator-introduced name
 * is removed, so "AltaEuro-compatible pull-out" and a leading "Hardware Resources pull" are untouched.
 */
const SUPPLIER_NAME = String.raw`(?:Alta\s*Euro|U\.?S\.?\s*Cabinet\s*Depot|USCD|AEF|Hardware\s+Resources)`;
const TRAILING_SUPPLIER_NAME = new RegExp(
  String.raw`\s*(?:[.;,|/–—]|\s-\s|\b(?:from|by|source:?)\s)\s*${SUPPLIER_NAME}(?:\s*[/&]\s*${SUPPLIER_NAME})*\s*\.?\s*$`,
  "i",
);
function tidy(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*-\s*/g, " - ")
    .replace(/\s+([,.;:])/g, "$1")
    .replace(/^[\s,;:–—-]+|[\s,;:–—-]+$/g, "")
    .trim();
}

function formattedDimension(value: string): string {
  return value.replace(/\s+/g, " ").replace(/\s*-\s*/g, "-").trim();
}

type DimensionMatch = {
  raw: string;
  formatted: string;
};

function matchedDimensions(value: string): DimensionMatch | null {
  const match = value.match(AXIS_DIMENSION_BLOCK) ?? value.match(BARE_DIMENSION_BLOCK);
  if (!match) return null;

  return {
    raw: match[0],
    formatted: `${formattedDimension(match[1])}\" W × ${formattedDimension(match[2])}\" H × ${formattedDimension(match[3])}\" D`,
  };
}

function removeDimensionBlock(value: string, dimensions: DimensionMatch | null): string {
  if (!dimensions) return value;
  // A matched block is always a leading or trailing block, so replacing only
  // its exact text cannot remove dimensional language inside a product name.
  return tidy(value.replace(dimensions.raw, " "));
}

function looksLikeCabinetName(value: string): boolean {
  return /\b(?:base|wall|tall|vanity|pantry|oven|utility|sink)\b/i.test(value)
    && !/\b(?:cabinet|moulding|molding|panel|filler|shelf|toe\s+kick|valance|rail|corbel|hardware|accessory|organizer|pull-?out|insert)\b/i.test(value);
}

function addCabinetNounWhenHelpful(value: string): string {
  if (!looksLikeCabinetName(value)) return value;
  // Insert after the cabinet-family noun, retaining all useful qualifiers such
  // as false drawer, inner drawer, handedness, and specialty details.
  if (/\bsink\s+base\b/i.test(value)) {
    return value.replace(/\bsink\s+base\b/i, "Sink Base Cabinet");
  }
  return value.replace(/\b(base|wall|tall|vanity|pantry|oven|utility|sink)\b/i, "$1 Cabinet");
}

/**
 * Removes only trailing, known provenance metadata from text intended for a
 * customer. This does not write to or otherwise alter the supplied source.
 */
export function sanitizeCatalogPublicDescription(value: string | null | undefined): string {
  if (!value?.trim()) return "";
  return tidy(
    value
      .replace(SUPPLIER_PROVENANCE_SUFFIX, "")
      .replace(BOOK_OR_IMPORT_PROVENANCE_SUFFIX, "")
      .replace(SOURCE_PAGE_SUFFIX, "")
      .replace(INTERNAL_PROOF_SUFFIX, "")
      .replace(LOOKS_LIKE_TAIL, "")
      .replace(TRAILING_SUPPLIER_NAME, ""),
  );
}

/** Builds compact public Product.name copy while retaining detailed product facts. */
export function compactCatalogProductTitle(value: string | null | undefined): string {
  const sourceFree = sanitizeCatalogPublicDescription(value);
  if (!sourceFree) return "";
  const dimensions = matchedDimensions(sourceFree);
  return addCabinetNounWhenHelpful(removeDimensionBlock(sourceFree, dimensions));
}

/**
 * Produces public-only presentation copy. Dimensions are moved out of the
 * heading into a readable description so Product.name stays compact while the
 * exact W/H/D values remain available to search engines and the UI spec table.
 */
export function catalogPublicCopy(
  value: string | null | undefined,
  fallback = "",
): PublicCatalogCopy {
  const sourceFree = sanitizeCatalogPublicDescription(value) || sanitizeCatalogPublicDescription(fallback);
  const dimensions = matchedDimensions(sourceFree);
  const title = compactCatalogProductTitle(sourceFree) || sanitizeCatalogPublicDescription(fallback) || "Cabinet";
  return {
    title,
    description: dimensions ? `${title}. Dimensions: ${dimensions.formatted}.` : title,
  };
}

/** Customer-safe annotation for a technical drawing; provenance is omitted. */
export function publicTechnicalDrawingNote(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;
  const cleaned = tidy(
    value
      .replace(/^(?:printed\s+)?(?:v?\d+(?:\.\d+)?)?\s*source\s+(?:geometry\s+and\s+face\s+layout|configuration)[:.]\s*/i, "")
      .replace(SOURCE_PAGE_SUFFIX, "")
      .replace(SUPPLIER_PROVENANCE_SUFFIX, "")
      .replace(BOOK_OR_IMPORT_PROVENANCE_SUFFIX, "")
      .replace(INTERNAL_PROOF_SUFFIX, ""),
  );
  return cleaned || null;
}
