export const SYMBOL_VIEW: Record<string, { glyph: string; name: string }> = {
  red: { glyph: '🔴', name: 'قرمز' }, blue: { glyph: '🔵', name: 'آبی' }, green: { glyph: '🟢', name: 'سبز' }, yellow: { glyph: '🟡', name: 'زرد' },
  star: { glyph: '⭐', name: 'ستاره' }, moon: { glyph: '🌙', name: 'ماه' }, heart: { glyph: '❤️', name: 'قلب' }, sun: { glyph: '☀️', name: 'خورشید' }, triangle: { glyph: '🔺', name: 'مثلث' },
};
export const ALL_SYMBOLS = Object.keys(SYMBOL_VIEW);
// Attention: colour + shape so meaning never depends on colour alone (accessibility).
export const COLOR_VIEW: Record<string, { fa: string; shape: string; css: string }> = {
  red: { fa: 'قرمز', shape: '▲', css: 'c-red' }, blue: { fa: 'آبی', shape: '●', css: 'c-blue' },
  green: { fa: 'سبز', shape: '■', css: 'c-green' }, yellow: { fa: 'زرد', shape: '★', css: 'c-yellow' },
};
