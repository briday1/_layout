/** Keep declarative application metadata separate from language/runtime hooks. */
export function defineAdapter(template, implementation) {
    return { ...template, ...implementation };
}
