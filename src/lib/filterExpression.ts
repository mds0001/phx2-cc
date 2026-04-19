/**
 * filterExpression.ts
 *
 * A simple expression evaluator for row filtering in mapping profiles.
 *
 * Supported operators:
 *   ==   !=   >   <   >=   <=
 *   contains   starts_with   ends_with
 *   is_empty   is_not_empty
 *   IS NULL   IS NOT NULL   (SQL-style null checks)
 *
 * Logical combinators: AND  OR  (case-insensitive)
 * Grouping: ( )
 *
 * Field references: bare word or `Field Name With Spaces` (backtick-quoted)
 * Values: "string"  'string'  123  123.45  true  false  null
 *
 * Examples:
 *   Status == "Active"
 *   Type != "Laptop" AND Manufacturer == "Dell"
 *   (Status == "Active" OR Status == "Trial") AND Price > 500
 *   `Asset Tag` is_not_empty
 *   Description contains "server"
 */

// ── Token types ───────────────────────────────────────────────

type TokenKind =
  | "FIELD"
  | "STRING"
  | "NUMBER"
  | "BOOL"
  | "NULL"
  | "OP"
  | "UNARY_OP"
  | "AND"
  | "OR"
  | "LPAREN"
  | "RPAREN"
  | "EOF";

interface Token {
  kind: TokenKind;
  value: string;
}

// ── Lexer ─────────────────────────────────────────────────────

const UNARY_OPS = ["is_empty", "is_not_empty", "is_null", "is_not_null"];
const BINARY_OPS = [
  "contains", "starts_with", "ends_with",
  ">=", "<=", "!=", "==", ">", "<",
];

function tokenize(expr: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < expr.length) {
    // skip whitespace
    if (/\s/.test(expr[i])) { i++; continue; }

    // backtick-quoted field name
    if (expr[i] === "`") {
      let j = i + 1;
      while (j < expr.length && expr[j] !== "`") j++;
      tokens.push({ kind: "FIELD", value: expr.slice(i + 1, j) });
      i = j + 1;
      continue;
    }

    // double-quoted string
    if (expr[i] === '"') {
      let j = i + 1;
      let str = "";
      while (j < expr.length && expr[j] !== '"') {
        if (expr[j] === "\\" && j + 1 < expr.length) { str += expr[j + 1]; j += 2; }
        else { str += expr[j]; j++; }
      }
      tokens.push({ kind: "STRING", value: str });
      i = j + 1;
      continue;
    }

    // single-quoted string
    if (expr[i] === "'") {
      let j = i + 1;
      let str = "";
      while (j < expr.length && expr[j] !== "'") {
        if (expr[j] === "\\" && j + 1 < expr.length) { str += expr[j + 1]; j += 2; }
        else { str += expr[j]; j++; }
      }
      tokens.push({ kind: "STRING", value: str });
      i = j + 1;
      continue;
    }

    // parentheses
    if (expr[i] === "(") { tokens.push({ kind: "LPAREN", value: "(" }); i++; continue; }
    if (expr[i] === ")") { tokens.push({ kind: "RPAREN", value: ")" }); i++; continue; }

    // two-char operators
    const twoChar = expr.slice(i, i + 2);
    if ([">=", "<=", "!=", "=="].includes(twoChar)) {
      tokens.push({ kind: "OP", value: twoChar });
      i += 2;
      continue;
    }

    // single-char operators
    if ([">", "<"].includes(expr[i])) {
      tokens.push({ kind: "OP", value: expr[i] });
      i++;
      continue;
    }

    // number
    if (/[0-9]/.test(expr[i]) || (expr[i] === "-" && /[0-9]/.test(expr[i + 1] ?? ""))) {
      let j = i;
      if (expr[j] === "-") j++;
      while (j < expr.length && /[0-9.]/.test(expr[j])) j++;
      tokens.push({ kind: "NUMBER", value: expr.slice(i, j) });
      i = j;
      continue;
    }

    // word — keyword, operator, or field name
    if (/[a-zA-Z_]/.test(expr[i])) {
      let j = i;
      while (j < expr.length && /[a-zA-Z0-9_]/.test(expr[j])) j++;
      const word = expr.slice(i, j);
      const upper = word.toUpperCase();

      // Handle SQL-style "IS NOT NULL" and "IS NULL" as unary operators
      if (upper === "IS") {
        // Peek ahead (skip whitespace) for "NOT NULL" or "NULL"
        let k = j;
        while (k < expr.length && /\s/.test(expr[k])) k++;
        const rest = expr.slice(k).toUpperCase();
        if (rest.startsWith("NOT")) {
          let k2 = k + 3;
          while (k2 < expr.length && /\s/.test(expr[k2])) k2++;
          if (expr.slice(k2).toUpperCase().startsWith("NULL")) {
            tokens.push({ kind: "UNARY_OP", value: "is_not_null" });
            i = k2 + 4;
            continue;
          }
        } else if (rest.startsWith("NULL")) {
          tokens.push({ kind: "UNARY_OP", value: "is_null" });
          i = k + 4;
          continue;
        }
      }

      if (upper === "AND") tokens.push({ kind: "AND", value: "AND" });
      else if (upper === "OR") tokens.push({ kind: "OR", value: "OR" });
      else if (upper === "TRUE") tokens.push({ kind: "BOOL", value: "true" });
      else if (upper === "FALSE") tokens.push({ kind: "BOOL", value: "false" });
      else if (upper === "NULL") tokens.push({ kind: "NULL", value: "null" });
      else if (UNARY_OPS.includes(word.toLowerCase())) tokens.push({ kind: "UNARY_OP", value: word.toLowerCase() });
      else if (BINARY_OPS.includes(word.toLowerCase())) tokens.push({ kind: "OP", value: word.toLowerCase() });
      else tokens.push({ kind: "FIELD", value: word });
      i = j;
      continue;
    }

    // skip unknown chars
    i++;
  }

  tokens.push({ kind: "EOF", value: "" });
  return tokens;
}

// ── AST ───────────────────────────────────────────────────────

type ASTNode =
  | { type: "binary"; op: string; left: ASTNode; right: ASTNode }
  | { type: "unary"; op: string; field: string }
  | { type: "comparison"; op: string; field: string; value: unknown }
  | { type: "and"; left: ASTNode; right: ASTNode }
  | { type: "or"; left: ASTNode; right: ASTNode };

// ── Parser ────────────────────────────────────────────────────

class Parser {
  private tokens: Token[];
  private pos = 0;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private peek(): Token { return this.tokens[this.pos]; }
  private consume(): Token { return this.tokens[this.pos++]; }

  parse(): ASTNode {
    const node = this.parseOr();
    return node;
  }

  private parseOr(): ASTNode {
    let left = this.parseAnd();
    while (this.peek().kind === "OR") {
      this.consume();
      const right = this.parseAnd();
      left = { type: "or", left, right };
    }
    return left;
  }

  private parseAnd(): ASTNode {
    let left = this.parsePrimary();
    while (this.peek().kind === "AND") {
      this.consume();
      const right = this.parsePrimary();
      left = { type: "and", left, right };
    }
    return left;
  }

  private parsePrimary(): ASTNode {
    const tok = this.peek();

    // grouped expression
    if (tok.kind === "LPAREN") {
      this.consume();
      const node = this.parseOr();
      if (this.peek().kind === "RPAREN") this.consume();
      return node;
    }

    // must be a field reference
    if (tok.kind !== "FIELD") {
      throw new Error(`Expected field name, got "${tok.value}"`);
    }
    this.consume();
    const fieldName = tok.value;

    const next = this.peek();

    // unary operator after field
    if (next.kind === "UNARY_OP") {
      this.consume();
      return { type: "unary", op: next.value, field: fieldName };
    }

    // binary comparison
    if (next.kind === "OP") {
      this.consume();
      const valTok = this.consume();
      let value: unknown;
      if (valTok.kind === "STRING") value = valTok.value;
      else if (valTok.kind === "NUMBER") value = parseFloat(valTok.value);
      else if (valTok.kind === "BOOL") value = valTok.value === "true";
      else if (valTok.kind === "NULL") value = null;
      else value = valTok.value;
      return { type: "comparison", op: next.value, field: fieldName, value };
    }

    throw new Error(`Expected operator after field "${fieldName}", got "${next.value}"`);
  }
}

// ── Evaluator ─────────────────────────────────────────────────

function coerce(raw: unknown): unknown {
  if (raw === null || raw === undefined) return null;
  return raw;
}

function evalNode(node: ASTNode, row: Record<string, unknown>): boolean {
  switch (node.type) {
    case "and":
      return evalNode(node.left, row) && evalNode(node.right, row);

    case "or":
      return evalNode(node.left, row) || evalNode(node.right, row);

    case "unary": {
      const raw = row[node.field];
      const isNull  = raw === null || raw === undefined;
      const isEmpty = isNull || String(raw).trim() === "";
      if (node.op === "is_null")     return isNull;
      if (node.op === "is_not_null") return !isNull;
      return node.op === "is_empty" ? isEmpty : !isEmpty;
    }

    case "comparison": {
      const raw = coerce(row[node.field]);
      const expected = node.value;
      const rawStr = raw === null ? "" : String(raw).toLowerCase();
      const expStr = expected === null ? "" : String(expected).toLowerCase();

      switch (node.op) {
        case "==":   return raw == expected; // loose equality intentional for mixed types
        case "!=":   return raw != expected;
        case ">":    return Number(raw) > Number(expected);
        case "<":    return Number(raw) < Number(expected);
        case ">=":   return Number(raw) >= Number(expected);
        case "<=":   return Number(raw) <= Number(expected);
        case "contains":    return rawStr.includes(expStr);
        case "starts_with": return rawStr.startsWith(expStr);
        case "ends_with":   return rawStr.endsWith(expStr);
        default:     return false;
      }
    }

    default:
      return true;
  }
}

// ── Public API ────────────────────────────────────────────────

export interface FilterResult {
  pass: boolean;
  error?: string;
}

/**
 * Evaluate a filter expression against a data row.
 * Returns { pass: true } if the row should be included,
 * { pass: false } if it should be skipped,
 * or { pass: true, error } if the expression couldn't be parsed (fail-open).
 */
export function evaluateFilter(
  row: Record<string, unknown>,
  expression: string | null | undefined
): FilterResult {
  if (!expression || expression.trim() === "") return { pass: true };

  try {
    const tokens = tokenize(expression);
    const parser = new Parser(tokens);
    const ast = parser.parse();
    return { pass: evalNode(ast, row) };
  } catch (err) {
    return { pass: true, error: (err as Error).message };
  }
}

/**
 * Validate an expression string (parse only, no row needed).
 * Returns null if valid, or an error message string if invalid.
 */
export function validateFilterExpression(expression: string): string | null {
  if (!expression || expression.trim() === "") return null;
  try {
    const tokens = tokenize(expression);
    const parser = new Parser(tokens);
    parser.parse();
    return null;
  } catch (err) {
    return (err as Error).message;
  }
}
