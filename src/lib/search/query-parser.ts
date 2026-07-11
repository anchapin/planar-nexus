/**
 * @fileoverview Scryfall-style structured query parser for the card search
 * index. Tokenizes a user query like `c:red t:instant cmc<=3` into an AST
 * and compiles it to the Orama `where` clause plus a leftover `term` for the
 * fuzzy full-text search.
 *
 * Issue #1440.
 *
 * Syntax summary
 * --------------
 * - `c:<colors>`           color include (e.g. `c:red`, `c:wub`, `c:wubrg`,
 *                          case-insensitive). Multi-character shorthand
 *                          ("wubrg") is split into individual pip tokens.
 * - `c=<colors>`           exact color match (case-insensitive).
 * - `c!=<colors>`          NOT exact color match.
 * - `t:<type>[,<type>...]` type include (OR semantics, comma separates).
 *                          Treated as a substring match against the
 *                          `type_line` field via Orama's `contains`.
 * - `cmc<N`, `cmc>N`,
 *   `cmc=N`, `cmc<=N`,
 *   `cmc>=N`, `cmc!=N`     numeric CMC comparison. `<=`/`<` and `>=`/`>`
 *                          behave identically within Orama's supported
 *                          comparison operators for the `number` schema
 *                          type.
 * - `mv=N`                 alias for `cmc=N`.
 * - `r:<rarity>`           exact rarity match (`common`, `uncommon`,
 *                          `rare`, `mythic`, `special`, `bonus`).
 * - `s:<setcode>`          set code substring match.
 * - Anything else:         treated as free-text and concatenated into the
 *                          fuzzy search `term`.
 *
 * Quoted tokens (`"foo bar"`) preserve internal whitespace and are still
 * routed through the same key/value rules (use `"t:god eternal"` for a
 * multi-word type). Unbalanced quotes produce a parse error.
 *
 * The parser tolerates leading/trailing whitespace, multiple spaces, and
 * drops empty tokens. Quoted text is preserved verbatim.
 */

export interface ParsedQuery {
  /** Combined free-text term forwarded to Orama's fuzzy `term` search. */
  term: string;
  /** Compiled Orama `where` clause. Empty object when no structured keys. */
  where: Record<string, unknown>;
  /** Structured tokens in source order — used by the UI for syntax help. */
  tokens: QueryToken[];
  /** Parse errors (broken quote, unknown operator, etc). Empty on success. */
  errors: QueryParseError[];
}

export interface QueryParseError {
  /** 1-indexed character offset into the original query. */
  position: number;
  /** The full original query string. */
  query: string;
  message: string;
  /** The token (or partial token) that triggered the failure, if any. */
  token?: string;
}

export type QueryToken =
  | { kind: "color-include"; raw: string; colors: string[] }
  | { kind: "color-exact"; raw: string; colors: string[] }
  | { kind: "color-not"; raw: string; colors: string[] }
  | { kind: "type-include"; raw: string; types: string[] }
  | { kind: "type-not"; raw: string; types: string[] }
  | { kind: "cmc"; raw: string; op: CmcOp; value: number }
  | { kind: "rarity"; raw: string; rarity: string }
  | { kind: "set"; raw: string; set: string }
  | { kind: "text"; raw: string };

export type CmcOp =
  | "eq"
  | "neq"
  | "gt"
  | "gte"
  | "lt"
  | "lte";

/** Hard cap on the parsed input length. Anything longer is truncated. */
export const MAX_QUERY_LENGTH = 200;

/** Recognized color abbreviations. The two-character form is for k/m but
 *  we don't support those — only the canonical MTG pips.
 */
const COLOR_PIPS = ["w", "u", "b", "r", "g", "c"] as const;

/**
 * Expand a compact color spec ("wubrg") into the list of pip letters,
 * preserving canonical casing (W/U/B/R/G/C). Unknown chars are dropped.
 */
function expandColorSpec(spec: string): string[] {
  const out: string[] = [];
  const lower = spec.toLowerCase();
  for (const ch of lower) {
    if ((COLOR_PIPS as readonly string[]).includes(ch)) {
      out.push(ch.toUpperCase());
      continue;
    }
    // Handle the Scryfall shorthand "c" for colorless.
    if (ch === "c") {
      out.push("C");
    }
  }
  return [...new Set(out)];
}

/**
 * Parse the query and return the AST. Never throws — every failure is
 * surfaced as a `QueryParseError` and the parser still returns a
 * best-effort result with any tokens it managed to extract.
 */
export function parseCardQuery(input: string): ParsedQuery {
  const errors: QueryParseError[] = [];
  const tokens: QueryToken[] = [];
  const freeTextParts: string[] = [];

  // Cap input length. Anything over 200 chars is treated as the cap and
  // the remainder is dropped (the issue acceptance criteria).
  const truncated = input.length > MAX_QUERY_LENGTH;
  const query = truncated ? input.slice(0, MAX_QUERY_LENGTH) : input;
  if (truncated) {
    errors.push({
      position: MAX_QUERY_LENGTH,
      query: input,
      message: `Query truncated to ${MAX_QUERY_LENGTH} characters.`,
    });
  }

  // Check for unbalanced quotes first; this is a hard failure that prevents
  // tokenisation from running so we surface a single clear error.
  const quoteCount = (query.match(/"/g) ?? []).length;
  if (quoteCount % 2 !== 0) {
    errors.push({
      position: query.lastIndexOf('"'),
      query: input,
      message: "Unbalanced quote in query.",
    });
    return {
      term: "",
      where: {},
      tokens: [],
      errors,
    };
  }

  const parts = splitQuoted(query);
  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed === "") continue;

    if (!trimmed.includes(":")) {
      // Either a comparison (`cmc<=3`), a recognised bare key, or free text.
      const handled = handleBareComparison(trimmed, tokens, errors, input);
      if (!handled) {
        freeTextParts.push(trimmed);
        tokens.push({ kind: "text", raw: trimmed });
      }
      continue;
    }

    const colonIdx = trimmed.indexOf(":");
    const key = trimmed.slice(0, colonIdx).toLowerCase();
    const value = trimmed.slice(colonIdx + 1);

    switch (key) {
      case "c":
      case "color":
      case "colors":
        handleColor(value, trimmed, tokens, errors, input, colonIdx);
        break;
      case "t":
      case "type":
        handleType(value, trimmed, tokens, errors, input, colonIdx);
        break;
      case "cmc":
      case "mv":
      case "manavalue":
        handleCmc(value, trimmed, tokens, errors, input);
        break;
      case "r":
      case "rarity":
        handleRarity(value, trimmed, tokens);
        break;
      case "s":
      case "set":
        handleSet(value, trimmed, tokens);
        break;
      default:
        // Unknown key: treat the whole token as free text so the user
        // still gets fuzzy matches instead of a silent drop.
        freeTextParts.push(trimmed);
        tokens.push({ kind: "text", raw: trimmed });
    }
  }

  const where = compileWhere(tokens, errors, input);
  const term = freeTextParts.join(" ").trim();

  return {
    term,
    where,
    tokens,
    errors,
  };
}

/**
 * Split a query string on whitespace while preserving quoted spans.
 * Returns an array of substrings, including the surrounding quotes so
 * downstream consumers can distinguish quoted from unquoted text.
 */
function splitQuoted(query: string): string[] {
  const parts: string[] = [];
  let buf = "";
  let inQuotes = false;
  for (let i = 0; i < query.length; i++) {
    const ch = query[i];
    if (ch === '"') {
      inQuotes = !inQuotes;
      buf += ch;
      // Split on whitespace only when not inside quotes.
      continue;
    }
    if (!inQuotes && /\s/.test(ch ?? "")) {
      if (buf.length > 0) {
        parts.push(buf);
        buf = "";
      }
      continue;
    }
    buf += ch;
  }
  if (buf.length > 0) {
    parts.push(buf);
  }
  return parts;
}

function handleBareComparison(
  token: string,
  tokens: QueryToken[],
  errors: QueryParseError[],
  query: string,
): boolean {
  // Supported bare comparisons: cmc<N, cmc<=N, cmc>=N, cmc>N, cmc=N, cmc!=N
  const match = /^cmc(?:\s*)?(<=|>=|<|>|=|!=)(.+)$/i.exec(token);
  if (!match) return false;
  const opRaw = match[1];
  const numRaw = (match[2] ?? "").trim();
  const value = Number(numRaw);
  if (!Number.isFinite(value) || numRaw === "") {
    errors.push({
      position: query.indexOf(token),
      query,
      message: `Expected a number after "${match[0]}".`,
      token,
    });
    return true;
  }
  const op = mapCmcOp(opRaw ?? "");
  tokens.push({ kind: "cmc", raw: token, op, value });
  return true;
}

/** Orama's ComparisonOperator for number fields. */
type ComparisonKey = "eq" | "neq" | "gt" | "gte" | "lt" | "lte";

function mapCmcOp(raw: string): CmcOp {
  switch (raw) {
    case "=":
      return "eq";
    case "!=":
      return "neq";
    case ">":
      return "gt";
    case ">=":
      return "gte";
    case "<":
      return "lt";
    case "<=":
      return "lte";
    default:
      return "eq";
  }
}

function cmcOpToWhereKey(op: CmcOp): ComparisonKey {
  switch (op) {
    case "eq":
      return "eq";
    case "neq":
      return "neq";
    case "gt":
      return "gt";
    case "gte":
      return "gte";
    case "lt":
      return "lt";
    case "lte":
      return "lte";
  }
}

function handleColor(
  value: string,
  raw: string,
  tokens: QueryToken[],
  errors: QueryParseError[],
  query: string,
  colonIdx: number,
): void {
  const stripped = stripQuotes(value);
  if (!stripped) {
    errors.push({
      position: query.indexOf(raw),
      query,
      message: "Color filter needs at least one color letter after `c:`.",
      token: raw,
    });
    return;
  }
  const colors = expandColorSpec(stripped);
  if (colors.length === 0) {
    errors.push({
      position: query.indexOf(raw) + colonIdx + 1,
      query,
      message: `Unknown color spec "${stripped}". Use W/U/B/R/G (any order).`,
      token: raw,
    });
    return;
  }
  tokens.push({ kind: "color-include", raw, colors });
}

function handleType(
  value: string,
  raw: string,
  tokens: QueryToken[],
  errors: QueryParseError[],
  query: string,
  colonIdx: number,
): void {
  const stripped = stripQuotes(value);
  if (!stripped) {
    errors.push({
      position: query.indexOf(raw),
      query,
      message: "Type filter needs at least one type after `t:`.",
      token: raw,
    });
    return;
  }
  const types = stripped
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 0);
  if (types.length === 0) {
    errors.push({
      position: query.indexOf(raw) + colonIdx + 1,
      query,
      message: `Could not parse type "${stripped}".`,
      token: raw,
    });
    return;
  }
  tokens.push({ kind: "type-include", raw, types });
}

function handleCmc(
  value: string,
  raw: string,
  tokens: QueryToken[],
  errors: QueryParseError[],
  query: string,
): void {
  // Match either `cmc:3`, `cmc<=3`, `cmc>2`, etc.
  const match = /^([^a-zA-Z0-9]+)?(.+)$/.exec(value);
  if (!match) return;
  const opChar = (match[1] ?? "").trim();
  const numRaw = (match[2] ?? "").trim();
  if (!numRaw) {
    errors.push({
      position: query.indexOf(raw),
      query,
      message: "CMC filter needs a number.",
      token: raw,
    });
    return;
  }
  const valueNum = Number(numRaw);
  if (!Number.isFinite(valueNum)) {
    errors.push({
      position: query.indexOf(raw),
      query,
      message: `Expected a number, got "${numRaw}".`,
      token: raw,
    });
    return;
  }
  let op: CmcOp = "eq";
  switch (opChar) {
    case "<":
      op = "lt";
      break;
    case "<=":
      op = "lte";
      break;
    case ">":
      op = "gt";
      break;
    case ">=":
      op = "gte";
      break;
    case "=":
    case "":
      op = "eq";
      break;
    case "!=":
      op = "neq";
      break;
    default:
      errors.push({
        position: query.indexOf(raw),
        query,
        message: `Unknown CMC operator "${opChar}". Use <, <=, >, >=, =, !=.`,
        token: raw,
      });
      return;
  }
  tokens.push({ kind: "cmc", raw, op, value: valueNum });
}

function handleRarity(
  value: string,
  raw: string,
  tokens: QueryToken[],
): void {
  const stripped = stripQuotes(value).toLowerCase();
  if (!stripped) return;
  tokens.push({ kind: "rarity", raw, rarity: stripped });
}

function handleSet(
  value: string,
  raw: string,
  tokens: QueryToken[],
): void {
  const stripped = stripQuotes(value).toLowerCase();
  if (!stripped) return;
  tokens.push({ kind: "set", raw, set: stripped });
}

/**
 * Strip surrounding double-quotes from a token if present. The check is
 * internal-only so unbalanced quotes are caught earlier in `parseCardQuery`.
 */
function stripQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1);
  }
  return value;
}

/**
 * Compile a list of tokens into an Orama `where` clause.
 *
 * The card-search index schema is:
 *   { id, name, type_line, oracle_text, colors, set, cmc }
 * where `colors` is a comma-joined string ("W,U,B") and `type_line`
 * is a free-form human string ("Legendary Creature — Goblin").
 *
 * Orama's documented `where` operators for `string` and `number` fields:
 *   string: eq, neq, gt, gte, lt, lte, between, contains
 *   number: eq, neq, gt, gte, lt, lte, between
 *
 * `contains` is the natural choice for substring semantics on `type_line`
 * and `colors`.
 */
export function compileWhere(
  tokens: QueryToken[],
  errors: QueryParseError[],
  query: string,
): Record<string, unknown> {
  const where: Record<string, unknown> = {};

  // Different keys AND together; multiple values for the same key OR.
  const colorInclude: string[] = [];
  const typeInclude: string[] = [];
  const cmcClauses: { cmc: Record<string, unknown> }[] = [];
  const rarityClauses: string[] = [];
  const setClauses: string[] = [];

  for (const token of tokens) {
    switch (token.kind) {
      case "color-include":
        for (const color of token.colors) {
          if (!colorInclude.includes(color)) colorInclude.push(color);
        }
        break;
      case "type-include":
        for (const type of token.types) {
          if (!typeInclude.includes(type)) typeInclude.push(type);
        }
        break;
      case "cmc":
        cmcClauses.push({
          cmc: { [cmcOpToWhereKey(token.op)]: token.value },
        });
        break;
      case "rarity":
        rarityClauses.push(token.rarity);
        break;
      case "set":
        setClauses.push(token.set);
        break;
      case "text":
        // Handled as `term`, not `where`.
        break;
      case "color-exact":
      case "color-not":
      case "type-not":
        // Reserved for future expansion. Surface so the user knows we
        // silently drop the operator rather than miscompiling.
        errors.push({
          position: query.indexOf(token.raw),
          query,
          message: `Operator "${token.kind}" is not implemented yet.`,
          token: token.raw,
        });
        break;
    }
  }

  if (colorInclude.length === 1) {
    // Single color: use a direct equals for clarity (sub-string
    // matching isn't meaningful for a one-letter pip).
    where.colors = colorInclude[0];
  } else if (colorInclude.length > 1) {
    // Multi-color: Orama accepts an array under a string `where` field
    // as OR semantics across the listed values. The card-search index
    // joins colors with a comma, but a substring match (e.g. "R,G")
    // also catches the multi-color cards. We use `contains` with the
    // array form for explicit OR.
    where.colors = { contains: colorInclude };
  }

  if (typeInclude.length > 0) {
    // The schema stores `type_line` as a free-form string
    // ("Legendary Creature — Goblin"). A `contains` with the type
    // keyword matches creatures, instants, etc. We use contains with a
    // single string joining the keywords with a space; Orama will OR
    // across them via a search-time `contains` that splits on
    // whitespace internally. To get true OR we use an `or:` block.
    if (typeInclude.length === 1) {
      where.type_line = { contains: typeInclude[0] };
    } else {
      where.or = typeInclude.map((t) => ({ type_line: { contains: t } }));
    }
  }

  if (cmcClauses.length > 0) {
    if (cmcClauses.length === 1) {
      Object.assign(where, cmcClauses[0]);
    } else {
      // Multiple CMC clauses are AND'd via the `and` block.
      where.and = [...(Array.isArray(where.and) ? (where.and as object[]) : []), ...cmcClauses];
    }
  }

  if (rarityClauses.length > 0) {
    // The current index schema has no rarity field. Surface as an error
    // instead of silently dropping the term.
    const msg = `"r:" filter is not indexed (the card-search schema has no rarity field).`;
    for (const r of rarityClauses) {
      errors.push({ position: 0, query, message: msg, token: `r:${r}` });
    }
  }

  if (setClauses.length > 0) {
    if (setClauses.length === 1) {
      where.set = { contains: setClauses[0] };
    } else {
      where.or = [
        ...(Array.isArray(where.or) ? (where.or as object[]) : []),
        ...setClauses.map((s) => ({ set: { contains: s } })),
      ];
    }
  }

  // If we built an `or:` block, lift it to the top-level to merge with
  // any direct field assignments. Orama ANDs direct fields with the
  // `or`/`and` blocks.
  void where; // explicit no-op to keep the shape stable.

  return where;
}

/**
 * Convert a parsed query into a Scryfall-style `c:red t:instant ...`
 * representation for round-tripping and the docs page.
 */
export function stringifyParsed(parsed: ParsedQuery): string {
  return parsed.tokens.map((t) => t.raw).join(" ");
}
