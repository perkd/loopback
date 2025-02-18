// JavaScript

const js = require('@eslint/js'),
    babelParser = require('@babel/eslint-parser'),
    nodePlugin = require('eslint-plugin-n'),
    stylisticJs = require('@stylistic/eslint-plugin-js'),
    eslintPluginJsonc = require('eslint-plugin-jsonc'),
    jsonParser = require('jsonc-eslint-parser'),
    security = require('eslint-plugin-security')

module.exports = [
    js.configs.recommended,
    nodePlugin.configs['flat/recommended-script'],
    {
        files: ['**/*.js'],
        languageOptions: {
            ecmaVersion: 2018,
            sourceType: 'module',
            parser: babelParser,
            parserOptions: {
                requireConfigFile: false,
                ecmaFeatures: {
                    impliedStrict: true,
                },
            },
        },
        plugins: {
            '@stylistic/js': stylisticJs,
            security,
        },
        rules: {
            indent: ['error', 'tab'],
            'max-len': [
                'error',
                {
                    code: 160,
                    tabWidth: 4,
                    ignoreTrailingComments: true,
                    ignoreStrings: true,
                    ignoreComments: true,
                    ignoreRegExpLiterals: true,
                },
            ],
            'object-shorthand': [
                'error',
                'always',
                {
                    ignoreConstructors: false,
                    avoidQuotes: true,
                },
            ],
            'n/exports-style': ['warn', 'module.exports', { allowBatchAssign: true }],
            'n/no-unpublished-require': 0,
            'n/no-extraneous-require': 0,
            eqeqeq: ['error', 'smart'],
            'quote-props': ['error', 'as-needed'],
            'arrow-body-style': 'warn',
            'arrow-parens': ['warn', 'as-needed'],
            'security/detect-object-injection': 'off',
            'consistent-return': 'warn',
            'no-console': ['warn'],
            'no-else-return': 'error',
            'no-mixed-spaces-and-tabs': 'error',
            'no-shadow': 'warn',
            'no-invalid-this': 'warn',
            'no-tabs': 'off',
            'no-unused-vars': 'off',
            'one-var': 'off',
            'require-jsdoc': 'off',
            'object-curly-spacing': ['error', 'always'],
            'padded-blocks': 'off',
            'prefer-rest-params': 'warn',
            camelcase: 'warn',
            'import/no-commonjs': 0,
            'import/no-nodejs-modules': 0,
            'space-infix-ops': ['error', { int32Hint: false }],
            'brace-style': ['error', 'stroustrup'],
            'operator-linebreak': ['error', 'before'],
            'comma-dangle': ['error', 'only-multiline'],
            'array-bracket-spacing': ['error', 'always'],
            'key-spacing': ['error', { beforeColon: false, afterColon: true }],
            'no-multiple-empty-lines': ['error', { max: 1, maxEOF: 1, maxBOF: 0 }],
            'no-trailing-spaces': ['error'],
            'jsonc/indent': ['error', 'tab'],
            '@stylistic/js/quotes': ['error', 'single', { avoidEscape: true }],
            'no-restricted-globals': ['error', {
                name: 'Event',
                message: 'Event must be explicitly defined',
            },
            ],
        }
    },
    {
        ignores: ['node_modules/**', 'dist/**', 'coverage/**'],
    },
    ...eslintPluginJsonc.configs['flat/recommended-with-json'],
    {
        files: ['**/*.json'],
        languageOptions: {
            parser: jsonParser,
        },
        rules: {
            semi: ['error', 'never'],
            'jsonc/indent': ['error', 2]
        }
    }
]