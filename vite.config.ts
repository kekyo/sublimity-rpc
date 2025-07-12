import { defineConfig } from 'vite';
import { resolve } from 'path';
import { fileURLToPath } from 'node:url';
import dts from 'vite-plugin-dts';
import screwUp from 'screw-up';

export default defineConfig({
  plugins: [
    dts({
      insertTypesEntry: true,
    }),
    screwUp()
  ],
  build: {
    lib: {
      entry: resolve(fileURLToPath(new URL('.', import.meta.url)), 'src/index.ts'),
      name: 'SublimityRpc',
      formats: ['es', 'cjs'],
      fileName: (format) => `index.${format === 'es' ? 'js' : 'cjs'}`,
    },
    rollupOptions: {
      external: [],output: {
        globals: {},
      }
    },
    target: 'es2018',
    minify: false,
  },
});
