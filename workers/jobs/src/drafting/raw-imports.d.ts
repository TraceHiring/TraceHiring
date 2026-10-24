// Vite's `?raw` import (a file's text as a string), used by tests only; this package has no vite/client types.
declare module '*?raw' {
  const text: string;
  export default text;
}
