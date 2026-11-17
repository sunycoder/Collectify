import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const directory = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
    root: directory,
    base: './',
    publicDir: false,
    plugins: [vue()],
    build: {
        outDir: path.resolve(directory, '../../../src/plugin-library/chinese-calendar/view'),
        emptyOutDir: true,
        sourcemap: false,
        target: 'es2022',
        modulePreload: { polyfill: false }
    }
});
