module.exports = {
  env: {
    node: true,
    es6: true
  },
  extends: ["eslint:recommended"],
  parser: "babel-eslint",
  parserOptions: {},
  rules: {
    semi: ["error", "never", { beforeStatementContinuationChars: "always" }],
    "no-extra-semi": off
  },
  plugins: ["babel"]
}
