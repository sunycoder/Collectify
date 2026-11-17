const fs = require('node:fs'),
    path = require('node:path');
const root = path.resolve(__dirname, '..'),
    source = path.join(root, 'plugins/sources/diff'),
    output = path.join(root, 'src/plugin-library/diff/vendor'),
    deps = path.join(source, 'node_modules');
async function build() {
    fs.mkdirSync(output, { recursive: true });
    const esbuild = require('esbuild');
    const common = { bundle: true, minify: true, legalComments: 'eof', nodePaths: [deps], logLevel: 'warning' };
    await esbuild.build({
        ...common,
        stdin: {
            contents: "export {diffChars,diffWordsWithSpace} from 'diff';",
            resolveDir: source,
            sourcefile: 'text-diff.js'
        },
        outfile: path.join(output, 'diff-text.js'),
        format: 'iife',
        globalName: 'DiffText',
        platform: 'browser'
    });
    await esbuild.build({
        ...common,
        entryPoints: [path.join(source, 'editor.js')],
        outfile: path.join(output, 'editor.js'),
        format: 'iife',
        platform: 'browser',
        loader: { '.ttf': 'file' }
    });
    await esbuild.build({
        ...common,
        entryPoints: [path.join(deps, 'monaco-editor/esm/vs/editor/editor.worker.js')],
        outfile: path.join(output, 'editor.worker.js'),
        format: 'iife',
        platform: 'browser'
    });
    await esbuild.build({
        ...common,
        entryPoints: [path.join(root, 'src/plugin-library/diff/worker.js')],
        outfile: path.join(output, 'compare-worker.cjs'),
        format: 'cjs',
        platform: 'node',
        target: 'node24',
        alias: { xlsx: path.join(root, 'build-tools/sheetjs/package/xlsx.js') }
    });
    for (const name of ['pdf.js', 'pdf.worker.js'])
        fs.copyFileSync(path.join(deps, 'pdfjs-dist/legacy/build', name), path.join(output, name));
    fs.copyFileSync(path.join(root, 'assets/对比.svg'), path.join(root, 'src/plugin-library/diff/icon/diff.svg'));
    fs.copyFileSync(
        path.join(deps, 'tesseract.js-core/tesseract-core-lstm.wasm.js'),
        path.join(output, 'ocr-core.cjs')
    );
    fs.copyFileSync(path.join(root, 'src/plugin-library/diff/ocr-worker.js'), path.join(output, 'ocr-worker.cjs'));
    for (const language of ['eng', 'chi_sim'])
        fs.copyFileSync(
            path.join(deps, '@tesseract.js-data', language, '4.0.0_best_int', language + '.traineddata.gz'),
            path.join(output, 'ocr-' + language + '.txt')
        );
    const licenses = [];
    for (const name of [
        'monaco-editor',
        'diff',
        'fflate',
        'fast-xml-parser',
        'strnum',
        'pdfjs-dist',
        'tesseract.js-core',
        '@tesseract.js-data/eng',
        '@tesseract.js-data/chi_sim'
    ]) {
        const directory = path.join(deps, name),
            file = fs.readdirSync(directory).find((n) => /^LICENSE(?:\.md|\.txt)?$/i.test(n));
        if (file) licenses.push(name + '\n' + fs.readFileSync(path.join(directory, file), 'utf8'));
        else {
            const pkg = JSON.parse(fs.readFileSync(path.join(directory, 'package.json'), 'utf8'));
            licenses.push(
                `${pkg.name} ${pkg.version}\nLicense: ${pkg.license}\nSource: ${pkg.repository?.url || pkg.homepage || ''}\n`
            );
        }
    }
    licenses.push('SheetJS 0.20.3\n' + fs.readFileSync(path.join(root, 'build-tools/sheetjs/package/LICENSE'), 'utf8'));
    fs.writeFileSync(
        path.join(root, 'src/plugin-library/diff/THIRD-PARTY-NOTICES.txt'),
        licenses.join('\n\n-----\n\n'),
        'utf8'
    );
    console.log('Diff editor, worker and offline document libraries built.');
}
build().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
