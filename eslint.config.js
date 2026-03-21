export default [
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      "no-unused-vars": "off",
      "no-console": "warn",
    },
  },
  {
    ignores: ["dist/", "node_modules/", "coverage/", "web/"],
  },
];
