// Stands in for "gpui-kit" and "gpui-base", so a view's drawing can be built and its click
// handlers found under node: every element records its id, children and on_click.
function el() {
  const t = { kids: [], click: null, idv: null };
  const p = new Proxy(t, {
    get(o, k) {
      if (k in o) return o[k];
      if (k === "then") return undefined;
      return (...a) => {
        if (k === "id") o.idv = a[0];
        else if (k === "on_click") o.click = a[0];
        else if (k === "child") o.kids.push(a[0]);
        else if (k === "children") o.kids.push(...a[0]);
        else if (k === "when" && a[0]) a[1](p);
        return p;
      };
    },
  });
  return p;
}
export const div = el, v_flex = el, h_flex = el, svg = el, image = el;
export const View = class {}, HoverCard = { new: () => el() };
export const Input = { new: () => el() }, Textarea = { new: () => el() };

// The element with this id in a drawing, or null.
export function find(e, id) {
  if (!e || typeof e !== "object" || !("kids" in e)) return null;
  if (e.idv === id) return e;
  for (const k of e.kids) { const f = find(k, id); if (f) return f; }
  return null;
}

// A text input: its value and the handlers it was given ("submit", "change", ...).
export const InputState = {
  new: () => {
    let v = "";
    const on = {};
    return { value: () => v, set_value: (x) => { v = String(x); }, on: (ev, fn) => { on[ev] = fn; }, handlers: on, focus() {}, set_selected_range() {} };
  },
};

// A textarea: an input that also takes its rows.
export const TextareaState = { new: () => Object.assign(InputState.new(), { set_rows() {}, set_auto_grow() {}, set_soft_wrap() {} }) };
