module.exports = {
  '*.{ts,tsx}': [
    'eslint --fix --max-warnings=0',
    'tsc --noEmit --pretty',
    'prettier --write --ignore-unknown'
  ],
  '*.{js,jsx}': [
    'eslint --fix --max-warnings=0',
    'prettier --write --ignore-unknown'
  ],
  '*.{json,md,css,scss}': ['prettier --write --ignore-unknown'],
};
