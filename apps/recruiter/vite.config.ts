import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// No `define` that reads process.env, and envPrefix stays the default `VITE_` (spec §10.1).
export default defineConfig({
  plugins: [react()],
});
