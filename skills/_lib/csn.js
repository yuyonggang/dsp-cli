/**
 * CSN helpers shared across table and view modification skills.
 */

/** Add cds. prefix if missing. */
export function normalizeCdsType(rawType) {
  if (!rawType) return "cds.String";
  return rawType.startsWith("cds.") ? rawType : `cds.${rawType}`;
}

/**
 * Parse a single column definition string.
 * Format: NAME:TYPE:LENGTH:LABEL  (LABEL may contain colons)
 * Decimal: NAME:cds.Decimal:PRECISION:SCALE:LABEL
 */
export function parseColumnDef(part) {
  const tokens = part.trim().split(":");
  const [name, rawType, lenOrPrec, ...rest] = tokens;
  const cdsType = normalizeCdsType(rawType);
  let length, scale, labelStart;
  if (cdsType === "cds.Decimal") {
    length = parseInt(lenOrPrec) || 15;
    scale = parseInt(rest[0]) || 0;
    labelStart = 1;
  } else {
    length = parseInt(lenOrPrec) || 10;
    labelStart = 0;
  }
  const label = rest.slice(labelStart).join(":") || name;
  return { name, cdsType, length, scale, label };
}

/** Parse the semicolon-separated columns flag. */
export function parseColumnsFlag(columnsStr) {
  return columnsStr.split(";").map(p => parseColumnDef(p));
}

/** True if column exists in csn.definitions[defKey].elements */
export function columnExistsIn(csn, defKey, colName) {
  const def = csn?.definitions?.[defKey];
  if (!def) return false;
  return Object.prototype.hasOwnProperty.call(def.elements || {}, colName);
}

/** Build a CDS element object for a parsed column. */
export function buildCdsElement(col) {
  const el = { type: col.cdsType };
  if (col.cdsType === "cds.Decimal") {
    el.precision = col.length;
    el.scale = col.scale || 0;
  } else if (col.length) {
    el.length = col.length;
  }
  if (col.label) {
    el["@EndUserText.label"] = col.label;
  }
  return el;
}
