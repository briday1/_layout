const KINDS = new Set(["node", "flow", "annotation", "graph"]);
const NAME = /^[a-zA-Z][\w-]*$/;

/** Convert top-level Pug-style reusable definitions to editable CSS rules. */
export function pugDefinitionsToStyleSheet(source = "") {
  const rules = [];
  let current = null;
  for (const line of String(source).split("\n")) {
    const header = line.match(/^@(node|flow|line|annotation|graph)\s+([a-zA-Z][\w-]*)\s*$/);
    if (header) {
      if (current) rules.push(`${current.header} {\n${current.fields.join("\n")}\n}`);
      current = { header: `@${header[1] === "line" ? "flow" : header[1]} ${header[2]}`, fields: [] };
      continue;
    }
    const field = line.match(/^\s+\.([a-z][\w-]*)\s+(.+)$/);
    if (current && field) current.fields.push(`  ${field[1]}: ${field[2]};`);
  }
  if (current) rules.push(`${current.header} {\n${current.fields.join("\n")}\n}`);
  return rules.join("\n\n");
}

/** Compile CSS-shaped reusable definitions into the diagram parser's definition prelude. */
export function compileStyleSheet(source = "") {
  const clean = String(source).replace(/\/\*[\s\S]*?\*\//g, "");
  const definitions = [];
  const errors = [];
  const consumed = [];
  const rule = /@(node|flow|line|annotation|graph)\s+([^\s{]+)\s*\{([\s\S]*?)\}/g;
  let match;
  while ((match = rule.exec(clean))) {
    consumed.push([match.index, rule.lastIndex]);
    const [, rawKind, name, body] = match;
    const kind = rawKind === "line" ? "flow" : rawKind;
    const line = clean.slice(0, match.index).split("\n").length;
    if (!KINDS.has(kind) || !NAME.test(name)) {
      errors.push(`CSS line ${line}: invalid @${kind} definition name "${name}".`);
      continue;
    }
    const fields = [];
    for (const declaration of body.split(";")) {
      const text = declaration.trim();
      if (!text) continue;
      const separator = text.indexOf(":");
      if (separator < 1) {
        errors.push(`CSS line ${line}: expected property: value; inside @${kind} ${name}.`);
        continue;
      }
      const property = text.slice(0, separator).trim();
      const value = text.slice(separator + 1).trim();
      if (!/^[a-z][\w-]*$/.test(property) || !value) {
        errors.push(`CSS line ${line}: invalid declaration "${text}".`);
        continue;
      }
      fields.push(`  .${property} ${value}`);
    }
    definitions.push(`@${kind} ${name}\n${fields.join("\n")}`);
  }
  let remainder = clean;
  for (const [start, end] of consumed.reverse()) remainder = remainder.slice(0, start) + remainder.slice(end);
  if (remainder.trim()) errors.push(`CSS line ${clean.slice(0, clean.indexOf(remainder.trim())).split("\n").length}: expected an @node, @flow, @graph, or @annotation rule.`);
  return { source: definitions.join("\n\n"), errors };
}
