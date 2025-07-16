import { defineConfig } from 'vite';
import { resolve } from 'path';
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
      entry: resolve(__dirname, 'src/index.ts'),
      name: 'SublimityRpc',
      fileName: (format, entryName) => `${entryName}.${format === 'es' ? 'mjs' : 'js'}`,
      formats: ['es', 'cjs'],
    },
    target: 'es2018',
    rollupOptions: {
      external: []
    }
  },
});
