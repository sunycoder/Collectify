import * as monaco from 'monaco-editor/editor/editor.api.js';
import 'monaco-editor/editor/contrib/hover/browser/hoverContribution.js';
import 'monaco-editor/editor/contrib/find/browser/findController.js';
import 'monaco-editor/editor/contrib/folding/browser/folding.js';
import 'monaco-editor/editor/contrib/contextmenu/browser/contextmenu.js';
import 'monaco-editor/editor/contrib/wordHighlighter/browser/wordHighlighter.js';
import 'monaco-editor/basic-languages/monaco.contribution.js';
window.MonacoEnvironment = {
    getWorkerUrl: () => new URL('./editor.worker.js', location.href.replace(/[^/]*$/, 'vendor/')).href
};
window.DiffEditor = monaco;
monaco.languages.register({ id: 'json', extensions: ['.json', '.jsonc'] });
monaco.languages.setMonarchTokensProvider('json', {
    tokenizer: {
        root: [
            [/"([^"\\]|\\.)*"(?=\s*:)/, 'string.key'],
            [/"([^"\\]|\\.)*"/, 'string'],
            [/-?\d+(\.\d+)?([eE][+-]?\d+)?/, 'number'],
            [/\b(true|false|null)\b/, 'keyword'],
            [/[{}\[\],:]/, 'delimiter'],
            [/\/\/.*$/, 'comment']
        ]
    }
});
