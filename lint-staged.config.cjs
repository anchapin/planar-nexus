module.exports = {
  '*.{ts,tsx}': [
    'eslint --fix --no-warn-ignored',
    () => 'tsc --noEmit --pretty',
    'prettier --write --ignore-unknown'
  ],
  '*.{js,jsx}': [
    'eslint --fix --no-warn-ignored',
    'prettier --write --ignore-unknown'
  ],
  '*.{json,md,css,scss}': ['prettier --write --ignore-unknown'],
};
