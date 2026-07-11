# setup-node-npm-ci

Composite setup action for CI jobs that need the standard Node.js workspace bootstrap.

## Inputs

- `node-version`: Node.js version passed to `actions/setup-node`. Defaults to `22`.
- `fetch-depth`: Git fetch depth passed to `actions/checkout`. Defaults to `1`; use `0` for jobs that inspect commit history.
- `npm-ci-args`: Optional arguments appended to `npm ci`.

## Output

- `node-modules-cache-key`: `${{ runner.os }}` + Node version + `package-lock.json` hash for downstream cache consumers.

## Example

```yaml
- name: Setup repository
  uses: ./.github/actions/setup-node-npm-ci
  with:
    node-version: '22'
```
