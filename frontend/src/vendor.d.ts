declare module 'turndown-plugin-gfm';
declare module 'mammoth/mammoth.browser.min.js';
declare module 'diff' {
  export interface Change { value: string; added?: boolean; removed?: boolean; count?: number }
  export function diffWordsWithSpace(oldStr: string, newStr: string): Change[];
}
