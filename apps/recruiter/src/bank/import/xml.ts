// XML on the page (ADR-033 ADR-1): the worker posts size-limited strings and the page parses them with DOMParser,
// which is a window API and does not exist in a worker. Office XML never carries a DTD, so a document that declares one
// is refused before it is parsed (no entity expansion, E9). Nothing here evaluates or fetches anything.

/** The root element of well-formed XML, or null (malformed, a parser error document, or a DTD). */
export function parseXml(text: string): Element | null {
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) return null;
  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(text, 'application/xml');
  } catch {
    return null;
  }
  if (doc.getElementsByTagName('parsererror').length > 0) return null;
  return doc.documentElement;
}

/** The element name without its prefix (`w:p` and `p` are both "p"). */
export const nameOf = (el: Element): string => el.localName;

/** Direct children with this local name. */
export function kids(el: Element, name: string): Element[] {
  const out: Element[] = [];
  for (const child of Array.from(el.children)) if (nameOf(child) === name) out.push(child);
  return out;
}

export function kid(el: Element, name: string): Element | null {
  return kids(el, name)[0] ?? null;
}

/** Every descendant with this local name, in document order. */
export function descendants(el: Element, name: string): Element[] {
  const out: Element[] = [];
  for (const node of Array.from(el.getElementsByTagName('*'))) {
    if (nameOf(node) === name) out.push(node);
  }
  return out;
}

/** An attribute by its local name, whatever its prefix (`w:val`, `r:id`, `val`). */
export function attr(el: Element, name: string): string | null {
  for (const a of Array.from(el.attributes)) {
    const local = a.name.includes(':') ? a.name.slice(a.name.indexOf(':') + 1) : a.name;
    if (local === name && !a.name.startsWith('xmlns')) return a.value;
  }
  return null;
}
