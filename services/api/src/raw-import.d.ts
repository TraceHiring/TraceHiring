// Vite's `?raw` import gives a file's text (tests only; org-cors.test.ts reads services/api/wrangler.jsonc, security
// review N1). The Worker's tsconfig loads no Vite client types, so the module shape is declared here.
declare module '*?raw' {
  const text: string;
  export default text;
}
