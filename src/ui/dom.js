// ---------------------------------------------------------------------------
// Tiny DOM builders shared by the control panel and the brand CMS panel.
// `el('div', { class, text, onclick, ...attrs }, children)` and a `section()`
// wrapper that matches the .panel-section convention in panel.css.
// ---------------------------------------------------------------------------

export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (v != null) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) if (c != null) node.append(c);
  return node;
}

export function section(title, body) {
  return el('section', { class: 'panel-section' }, [el('h2', { text: title }), body]);
}

/** A titled sub-block inside a combined panel section. */
export function subGroup(title, body) {
  return el('div', { class: 'sub-group' }, [el('h3', { class: 'sub-title', text: title }), body]);
}
