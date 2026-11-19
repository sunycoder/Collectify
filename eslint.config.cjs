module.exports = [
    {
        ignores: [
            '**/vendor/**',
            'dist/**',
            '.plugin-release/**',
            'node_modules/**',
            'build-tools/**',
            'src/default-packages/**'
        ]
    },
    {
        files: [
            'src/host/**/*.js',
            'src/main.js',
            'src/plugin-system/runtime.js',
            'src/plugin-system/{request-contract,operation-metrics,process-task,services,plugin-windows}.js',
            'src/plugin-system/task-process.cjs',
            'src/plugins/.shared/{domain-store,entity-repository}.js',
            'src/plugins/{bookmarks/store,notes/model,notes/contracts,tasks/model,tasks/contracts}.js'
        ],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: Object.fromEntries(
                [
                    'process',
                    'Buffer',
                    '__dirname',
                    'URL',
                    'Response',
                    'setTimeout',
                    'clearTimeout',
                    'setInterval',
                    'clearInterval',
                    'setImmediate',
                    'AbortController',
                    'structuredClone',
                    'performance',
                    'console'
                ].map((k) => [k, 'readonly'])
            )
        },
        rules: {
            'no-undef': 'error',
            'no-unused-vars': ['error', { args: 'none', caughtErrors: 'none' }],
            eqeqeq: 'error',
            'no-unreachable': 'error',
            'no-unsafe-finally': 'error',
            'no-async-promise-executor': 'error'
        }
    }
];
