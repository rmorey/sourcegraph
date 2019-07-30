// @ts-nocheck

const baseConfig = require('@sourcegraph/tslint-config')

module.exports = {
  extends: ['@sourcegraph/tslint-config'],
  linterOptions: { exclude: ['node_modules/**'] },
  rules: {
    'await-promise': false,
    'import-blacklist': [true, 'highlight.js', 'marked'],
    ban: [
      true,
      ...baseConfig.rules.ban,
      { name: ['assert', 'strictEqual'], message: 'Use jest matchers instead.' },
      { name: ['assert', 'deepStrictEqual'], message: 'Use jest matchers instead.' },
      { name: ['test', 'only'], message: "Don't commit 'only' test directives." },
    ],
    'jsx-ban-elements': [
      true,
      [
        '^form$',
        'Use the Form component in src/components/Form.tsx instead of the native HTML form element to get proper form validation feedback',
      ],
      [
        '^select$',
        'Use the Select component in src/components/Select.tsx instead of the native HTML select element for proper cross-browser styling',
      ],
    ],
    'variable-name': false,
  },
}
