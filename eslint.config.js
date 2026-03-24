/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/.
 * Portions Copyright (C) Philipp Kewisch, 2019 */
"use strict";

const babelParser = require("@babel/eslint-parser");

module.exports = [
  {
    ignores: ["node_modules/", "dist/", ".git/"],
  },
  {
    files: ["src/**/*.js"],
    languageOptions: {
      parser: babelParser,
      parserOptions: {
        ecmaVersion: 2024,
        sourceType: "module",
        requireConfigFile: false,
      },
      globals: {
        messenger: true,
        browser: true,
      },
    },
    rules: {
      // Enforce one true brace style (opening brace on the same line)
      // Allow single line (for now) because of the vast number of changes needed
      "brace-style": [2, "1tbs", { allowSingleLine: true }],

      // Enforce newline at the end of file, with no multiple empty lines.
      "eol-last": 2,

      // Disallow using variables outside the blocks they are defined
      "block-scoped-var": 2,

      // Allow trailing commas for easy list extension.  Having them does not
      // impair readability, but also not required either.
      "comma-dangle": 0,

      // Enforce spacing before and after comma
      "comma-spacing": [2, { before: false, after: true }],

      // Enforce one true comma style.
      "comma-style": [2, "last"],

      // We should get better at complexity, but at the moment it is what it is
      complexity: [2, 90],

      // Enforce curly brace conventions for all control statements.
      curly: 2,

      // Require space before/after arrow function's arrow
      "arrow-spacing": [2, { before: true, after: true }],

      // Enforces spacing between keys and values in object literal properties.
      "key-spacing": [2, { beforeColon: false, afterColon: true, mode: "minimum" }],

      // Disallow the omission of parentheses when invoking a constructor with no
      // arguments.
      "new-parens": 2,

      // Disallow use of the Array constructor.
      "no-array-constructor": 2,

      // disallow use of the Object constructor
      "no-new-object": 2,

      // Disallow Primitive Wrapper Instances
      "no-new-wrappers": 2,

      // Disallow the catch clause parameter name being the same as a variable in
      // the outer scope, to avoid confusion.
      "no-catch-shadow": 2,

      // Disallow assignment in conditional expressions.
      "no-cond-assign": 2,

      // Disallow use of debugger.
      "no-debugger": 2,

      // Disallow deletion of variables (deleting properties is fine).
      "no-delete-var": 2,

      // Disallow duplicate arguments in functions.
      "no-dupe-args": 2,

      // Disallow duplicate keys when creating object literals.
      "no-dupe-keys": 2,

      // Disallow a duplicate case label.
      "no-duplicate-case": 2,

      // Disallow else blocks after returns
      "no-else-return": 2,

      // Disallow labels that are variables names which are defined elsewhere
      "no-label-var": 2,

      // Disallow unnecessary nested blocks
      "no-lone-blocks": 2,

      // Disallow multiple spaces
      "no-multi-spaces": [2, { exceptions: { Property: true, VariableDeclarator: true, ImportDeclaration: true } }],

      // Disallow multiple empty lines
      "no-multiple-empty-lines": [2, { max: 1 }],

      // Disallow reassignments of native objects
      "no-global-assign": 2,

      // Disallow the use of object properties of the global object (Math and JSON)
      // as functions
      "no-obj-calls": 2,

      // Disallow octal escape sequences in string literals
      "no-octal-escape": 2,

      // Disallow octal literals
      "no-octal": 2,

      // Disallow shadowing of names such as arguments
      "no-shadow-restricted-names": 2,

      // Disallow sparse arrays
      "no-sparse-arrays": 2,

      // Disallow the use of Boolean literals in conditional expressions.
      "no-constant-condition": 2,

      // Disallow use of the void operator (void is valid in web extensions for no-op)
      "no-void": 0,

      // Disallow unnecessary parentheses
      "no-extra-parens": 0,

      // Disallow unreachable statements after a return, throw, continue, or break
      // statement
      "no-unreachable": 2,

      // Require assignment operator shorthand where possible.
      "operator-assignment": [2, "always"],

      // Require leading zeros for decimals
      "no-floating-decimal": 2,

      // Disallow newline before open brace
      "keyword-spacing": 2,

      // Enforce newlines between operands of ternary expressions
      "operator-linebreak": [2, "after"],
    },
  },
];
