import js from '@eslint/js';
import { FlatCompat } from '@eslint/eslintrc';

const compat = new FlatCompat();

export default [
    js.configs.recommended,
    ...compat.extends('loopback'),
    {
        rules: {
            'max-len': ['error', {
                code: 100,
                tabWidth: 4,
                ignoreComments: true,
                ignoreUrls: true,
                ignorePattern: '^\\s*var\\s.+=\\s*(require\\s*\\()|(/)'
            }]
        }
    }
];