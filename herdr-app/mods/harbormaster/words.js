// Small wording helpers with no imports, so the pure rule modules (attention.js, needaction.js)
// and the views (ui.js re-exports plural) word things the same way.

// "1 task", "3 tasks"; `many` for an irregular plural.
export const plural = (n, word, many = `${word}s`) => `${n} ${n === 1 ? word : many}`;

// "#1, #2 and #3"
export const andList = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0] ?? "");
