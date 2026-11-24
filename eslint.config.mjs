import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";

/** 全仓 ESLint flat config（server/web/shared/cli 共用）。
 *  定位：把规则当「质量护栏」而非「风格警察」——类型/未用变量给 warn，any 放行，
 *  不阻断 build，先让团队跑起来、逐步收敛。 */
export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/*.map",
      "coverage/**",
      "services/**",
      "scripts/**",
      "docs/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.browser },
      ecmaVersion: 2022,
      sourceType: "module",
    },
    rules: {
      // TS 由编译器负责未声明变量检查，ESLint 的 no-undef 在类型世界里会误报
      "no-undef": "off",
      // 存量代码较大量使用 any（NestJS 注入、JSON 列等），先放行避免噪音
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-empty": ["warn", { allowEmptyCatch: true }],
      "prefer-const": "warn",
      // 以下为存量代码既有写法，先降为 warn 不阻断 CI，后续渐进收敛
      "no-control-regex": "warn",
      "no-irregular-whitespace": "warn",
      "@typescript-eslint/no-require-imports": "warn",
    },
  },
  {
    // React 组件文件：接入 react-hooks 规则，消解源码中已有的 exhaustive-deps 注释
    files: ["**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
);
