/* jshint globalstrict: true */
/* global filter: false */
"use strict";

import _ from "lodash";
import { filter } from './filter';

const ESCAPES = {
  n: "\n",
  f: "\f",
  r: "\r",
  t: "\t",
  v: "\v",
  "'": "'",
  '"': '"'
};
const CALL = Function.prototype.call;
const APPLY = Function.prototype.apply;
const BIND = Function.prototype.bind;
const OPERATORS = {
  "+": true,
  "!": true,
  "-": true,
  "*": true,
  "/": true,
  "%": true,
  "=": true,
  "==": true,
  "===": true,
  "!=": true,
  "!==": true,
  "<": true,
  ">": true,
  "<=": true,
  ">=": true,
  "&&": true,
  "||": true,
  "|": true
};

function ensureSafeMemberName(name) {
  if (
    name === "constructor" ||
    name === "__proto__" ||
    name === "__defineGetter__" ||
    name === "__defineSetter__" ||
    name === "__lookupGetter__" ||
    name === "__lookupSetter__"
  ) {
    throw "Attempting to access a disallowed field in Angular expressions!";
  }
}
function ensureSafeObject(obj) {
  if (obj) {
    if (obj.document && obj.location && obj.alert && obj.setInterval) {
      throw "Refactoring window in Angular expressions is disallowed!";
    } else if (
      obj.children &&
      (obj.nodeName || (obj.prop && obj.attr && obj.find))
    ) {
      throw "Referencing DOM nodes in Angular expressions is disallowed!";
    } else if (obj.constructor === obj) {
      throw "Referencing Function in Angular expressions is disallowed!";
    } else if (obj.getOwnPropertyNames || obj.getOwnPropertyDescriptor) {
      throw "Referencing Object in Angular expressions is disallowd!";
    }
  }
  return obj;
}
function ensureSafeFunction(obj) {
  if (obj) {
    if (obj.constructor === obj) {
      throw "Referencing Function in Angular expressions is disallowd!";
    } else if (obj === CALL || obj === APPLY || obj === BIND) {
      throw "Referencing call, apply or bind in Angular expressions is disallowed!";
    }
  }
  return obj;
}
function ifDefined(value, defaultValue) {
  return typeof value === "undefined" ? defaultValue : value;
}

export function parse(expr) {
  const lexer = new Lexer();
  const parser = new Parser(lexer);
  return parser.parse(expr);
}

function Lexer() {}
Lexer.prototype.lex = function(text) {
  this.text = text;
  this.index = 0;
  this.ch = undefined;
  this.tokens = [];
  while (this.index < this.text.length) {
    this.ch = this.text.charAt(this.index);
    if (
      this.isNumber(this.ch) ||
      (this.is(".") && this.isNumber(this.peek()))
    ) {
      this.readNumber();
    } else if (this.is("'\"")) {
      this.readString(this.ch);
    } else if (this.is("[],{}:.()?;")) {
      this.tokens.push({
        text: this.ch
      });
      this.index++;
    } else if (this.isIdent(this.ch)) {
      this.readIdent();
    } else if (this.isWhitespace(this.ch)) {
      this.index++;
    } else {
      const ch = this.ch;
      const ch2 = this.ch + this.peek();
      const ch3 = this.ch + this.peek() + this.peek(2);
      const op = OPERATORS[ch];
      const op2 = OPERATORS[ch2];
      const op3 = OPERATORS[ch3];
      if (op || op2 || op3) {
        const token = op3 ? ch3 : op2 ? ch2 : ch;
        this.tokens.push({ text: token });
        this.index += token.length;
      } else {
        throw "Unexpected next character: " + this.ch;
      }
    }
  }
  return this.tokens;
};
Lexer.prototype.is = function(chs) {
  return chs.indexOf(this.ch) >= 0;
};
Lexer.prototype.readString = function(quote) {
  this.index++;
  let string = "";
  let rawString = quote;
  let escape = false;
  while (this.index < this.text.length) {
    const ch = this.text.charAt(this.index);
    rawString += ch;
    if (escape) {
      if (ch === "u") {
        const hex = this.text.substring(this.index + 1, this.index + 5);
        if (!hex.match(/[\da-f]{4}/i)) {
          throw "Invalid unicode escape";
        }
        this.index += 4;
        string += String.fromCharCode(parseInt(hex, 16));
      } else {
        const replacement = ESCAPES[ch];
        if (replacement) {
          string += replacement;
        } else {
          string += ch;
        }
      }
      escape = false;
    } else if (ch === quote) {
      this.index++;
      this.tokens.push({
        text: rawString,
        value: string
      });
      return;
    } else if (ch === "\\") {
      escape = true;
    } else {
      string += ch;
    }
    this.index++;
  }
};
Lexer.prototype.readIdent = function() {
  let text = "";
  while (this.index < this.text.length) {
    const ch = this.text.charAt(this.index);
    if (this.isIdent(ch) || this.isNumber(ch)) {
      text += ch;
    } else {
      break;
    }
    this.index++;
  }
  const token = { text: text, identifier: true };
  this.tokens.push(token);
};
Lexer.prototype.isNumber = function(ch) {
  return "0" <= ch && ch <= "9";
};
Lexer.prototype.readNumber = function() {
  let number = "";
  while (this.index < this.text.length) {
    const ch = this.text.charAt(this.index).toLowerCase();
    if (ch === "." || this.isNumber(ch)) {
      number += ch;
    } else {
      const nextCh = this.peek();
      const prevCh = number.charAt(number.length - 1);
      if (ch === "e" && this.isExpOperator(nextCh)) {
        number += ch;
      } else if (
        this.isExpOperator(ch) &&
        prevCh === "e" &&
        nextCh &&
        this.isNumber(nextCh)
      ) {
        number += ch;
      } else if (
        this.isExpOperator(ch) &&
        prevCh === "e" &&
        (!nextCh || !this.isNumber(nextCh))
      ) {
        throw "Invalid exponent";
      } else {
        break;
      }
    }
    this.index++;
  }
  this.tokens.push({
    text: number,
    value: Number(number)
  });
};
Lexer.prototype.peek = function(n) {
  n = n || 1;
  return this.index + n < this.text.length
    ? this.text.charAt(this.index + n)
    : false;
};
Lexer.prototype.isExpOperator = function(ch) {
  return ch === "-" || ch === "+" || this.isNumber(ch);
};
Lexer.prototype.isIdent = function(ch) {
  return (
    (ch >= "a" && ch <= "z") ||
    (ch >= "A" && ch <= "Z") ||
    ch === "_" ||
    ch === "$"
  );
};
Lexer.prototype.isWhitespace = function(ch) {
  return (
    ch === " " ||
    ch === "\r" ||
    ch === "\t" ||
    ch === "\n" ||
    ch === "\v" ||
    ch === "\u00A0"
  );
};

function AST(lexer) {
  this.lexer = lexer;
}
AST.Program = "Program";
AST.Literal = "Literal";
AST.ArrayExpression = "ArrayExpression";
AST.ObjectExpression = "ObjectExpression";
AST.Property = "Property";
AST.Identifier = "Identifier";
AST.ThisExpression = "ThisExpression";
AST.MemberExpression = "MemberExpression";
AST.CallExpression = "CallExpression";
AST.AssignmentExpression = "AssignmentExpression";
AST.UnaryExpression = "UnaryExpression";
AST.BinaryExpression = "BinaryExpression";
AST.LogicalExpression = "LogicalExpression";
AST.ConditionalExpression = "ConditionalExpression";

AST.prototype.ast = function(text) {
  this.tokens = this.lexer.lex(text);
  return this.program();
};
AST.prototype.program = function() {
  const body = [];
  while (true) {
    if (this.tokens.length) {
      body.push(this.filter());
    }
    if (!this.expect(";")) {
      return { type: AST.Program, body: body };
    }
  }
};
AST.prototype.primary = function() {
  let primary;
  if (this.expect("(")) {
    primary = this.filter();
    this.consume(")");
  } else if (this.expect("[")) {
    primary = this.arrayDeclaration();
  } else if (this.expect("{")) {
    primary = this.object();
  } else if (this.constants.hasOwnProperty(this.tokens[0].text)) {
    primary = this.constants[this.consume().text];
  } else if (this.peek().identifier) {
    primary = this.identifier();
  } else {
    primary = this.constant();
  }
  let next;
  while ((next = this.expect(".", "[", "("))) {
    if (next.text === "[") {
      primary = {
        type: AST.MemberExpression,
        object: primary,
        property: this.primary(),
        computed: true
      };
      this.consume("]");
    } else if (next.text === ".") {
      primary = {
        type: AST.MemberExpression,
        object: primary,
        property: this.identifier(),
        computed: false
      };
    } else if (next.text === "(") {
      primary = {
        type: AST.CallExpression,
        callee: primary,
        arguments: this.parseArguments()
      };
      this.consume(")");
    }
  }
  return primary;
};
AST.prototype.constant = function() {
  return { type: AST.Literal, value: this.consume().value };
};
AST.prototype.constants = {
  null: { type: AST.Literal, value: null },
  true: { type: AST.Literal, value: true },
  false: { type: AST.Literal, value: false },
  this: { type: AST.ThisExpression }
};
AST.prototype.peek = function(e1, e2, e3, e4) {
  if (this.tokens.length > 0) {
    const text = this.tokens[0].text;
    if (
      text === e1 ||
      text === e2 ||
      text === e3 ||
      text === e4 ||
      (!e1 && !e2 && !e3 && !e4)
    ) {
      return this.tokens[0];
    }
  }
};
AST.prototype.expect = function(e1, e2, e3, e4) {
  const token = this.peek(e1, e2, e3, e4);
  if (token) {
    return this.tokens.shift();
  }
};
AST.prototype.object = function() {
  const properties = [];
  if (!this.peek("}")) {
    do {
      const property = { type: AST.Property };
      if (this.peek().identifier) {
        property.key = this.identifier();
      } else {
        property.key = this.constant();
      }
      this.consume(":");
      property.value = this.assignment();
      properties.push(property);
    } while (this.expect(","));
  }
  this.consume("}");
  return { type: AST.ObjectExpression, properties: properties };
};
AST.prototype.identifier = function() {
  return { type: AST.Identifier, name: this.consume().text };
};
AST.prototype.arrayDeclaration = function() {
  const elements = [];
  if (!this.peek("]")) {
    do {
      if (this.peek("]")) {
        break;
      }
      elements.push(this.assignment());
    } while (this.expect(","));
  }
  this.consume("]");
  return { type: AST.ArrayExpression, elements: elements };
};
AST.prototype.consume = function(e) {
  const token = this.expect(e);
  if (!token) {
    throw "Unexpected. Expecting: " + e;
  }
  return token;
};
AST.prototype.parseArguments = function() {
  const args = [];
  if (!this.peek(")")) {
    do {
      args.push(this.assignment());
    } while (this.expect(","));
  }
  return args;
};
AST.prototype.assignment = function() {
  const left = this.ternary();
  if (this.expect("=")) {
    const right = this.ternary();
    return { type: AST.AssignmentExpression, left: left, right: right };
  }
  return left;
};
AST.prototype.unary = function() {
  let token;
  if ((token = this.expect("+", "!", "-"))) {
    return {
      type: AST.UnaryExpression,
      operator: token.text,
      argument: this.unary()
    };
  } else {
    return this.primary();
  }
};
AST.prototype.multiplicative = function() {
  let left = this.unary();
  let token;
  while ((token = this.expect("*", "/", "%"))) {
    left = {
      type: AST.BinaryExpression,
      left: left,
      operator: token.text,
      right: this.unary()
    };
  }
  return left;
};
AST.prototype.additive = function() {
  let left = this.multiplicative();
  let token;
  while ((token = this.expect("+")) || (token = this.expect("-"))) {
    left = {
      type: AST.BinaryExpression,
      left: left,
      operator: token.text,
      right: this.multiplicative()
    };
  }
  return left;
};
AST.prototype.equality = function() {
  let left = this.relational();
  let token;
  while ((token = this.expect("==", "!=", "===", "!=="))) {
    left = {
      type: AST.BinaryExpression,
      left: left,
      operator: token.text,
      right: this.relational()
    };
  }
  return left;
};
AST.prototype.relational = function() {
  let left = this.additive();
  let token;
  while ((token = this.expect("<", ">", "<=", ">="))) {
    left = {
      type: AST.BinaryExpression,
      left: left,
      operator: token.text,
      right: this.additive()
    };
  }
  return left;
};
AST.prototype.logicalOR = function() {
  let left = this.logicalAND();
  let token;
  while ((token = this.expect("||"))) {
    left = {
      type: AST.LogicalExpression,
      left: left,
      operator: token.text,
      right: this.logicalAND()
    };
  }
  return left;
};
AST.prototype.logicalAND = function() {
  let left = this.equality();
  let token;
  while ((token = this.expect("&&"))) {
    left = {
      type: AST.LogicalExpression,
      left: left,
      operator: token.text,
      right: this.equality()
    };
  }
  return left;
};
AST.prototype.ternary = function() {
  let test = this.logicalOR();
  if (this.expect("?")) {
    const consequent = this.assignment();
    if (this.consume(":")) {
      const alternate = this.assignment();
      return {
        type: AST.ConditionalExpression,
        test: test,
        consequent: consequent,
        alternate: alternate
      };
    }
  }
  return test;
};
AST.prototype.filter = function() {
  let left = this.assignment();
  while (this.expect("|")) {
    const args = [left];
    left = {
      type: AST.CallExpression,
      callee: this.identifier(),
      arguments: args,
      filter: true
    };
    while (this.expect(':')) {
      args.push(this.assignment());
    }
  }
  return left;
};

function ASTCompiler(astBuilder) {
  this.astBuilder = astBuilder;
}
ASTCompiler.prototype.compile = function(text) {
  const ast = this.astBuilder.ast(text);
  this.state = { body: [], nextId: 0, vars: [], filters: {} };
  this.recurse(ast);
  const fnString =
    this.filterPrefix() +
    "var fn=function(s,l){" +
    (this.state.vars.length ? "var " + this.state.vars.join(",") + ";" : "") +
    this.state.body.join("") +
    "}; return fn;";
  /* jshint -W054 */
  return new Function(
    "ensureSafeMemberName",
    "ensureSafeObject",
    "ensureSafeFunction",
    "ifDefined",
    "filter",
    fnString
  )(
    ensureSafeMemberName,
    ensureSafeObject,
    ensureSafeFunction,
    ifDefined,
    filter
  );
  /* jshint +W054 */
};
ASTCompiler.prototype.recurse = function(ast, context, create) {
  let intoId;
  switch (ast.type) {
    case AST.Program:
      _.forEach(_.initial(ast.body), stmt => {
        this.state.body.push(this.recurse(stmt), ";");
      });
      this.state.body.push("return ", this.recurse(_.last(ast.body)), ";");
      break;
    case AST.Literal:
      return this.escape(ast.value);
    case AST.ArrayExpression:
      const elements = _.map(ast.elements, element => {
        return this.recurse(element);
      });
      return "[" + elements.join(",") + "]";
    case AST.ObjectExpression:
      const properties = _.map(ast.properties, property => {
        const key =
          property.key.type === AST.Identifier
            ? property.key.name
            : this.escape(property.key.value);
        const value = this.recurse(property.value);
        return key + ":" + value;
      });
      return "{" + properties.join(",") + "}";
    case AST.Identifier:
      ensureSafeMemberName(ast.name);
      intoId = this.nextId();
      this.if_(
        this.getHasOwnProperty("l", ast.name),
        this.assign(intoId, this.nonComputedMember("l", ast.name))
      );
      if (create) {
        this.if_(
          this.not(this.getHasOwnProperty("l", ast.name)) +
            " && s && " +
            this.not(this.getHasOwnProperty("s", ast.name)),
          this.assign(this.nonComputedMember("s", ast.name), "{}")
        );
      }
      this.if_(
        this.not(this.getHasOwnProperty("l", ast.name)) + " && s",
        this.assign(intoId, this.nonComputedMember("s", ast.name))
      );
      if (context) {
        context.context = this.getHasOwnProperty("l", ast.name) + "?l:s";
        context.name = ast.name;
        context.computed = false;
      }
      this.addEnsureSafeObject(intoId);
      return intoId;
    case AST.ThisExpression:
      return "s";
    case AST.MemberExpression:
      intoId = this.nextId();
      const left = this.recurse(ast.object, undefined, create);
      if (context) {
        context.context = left;
      }
      if (ast.computed) {
        const right = this.recurse(ast.property);
        this.addEnsureSafeMemberName(right);
        if (create) {
          this.if_(
            this.not(this.computedMember(left, right)),
            this.assign(this.computedMember(left, right), "{}")
          );
        }
        this.if_(
          left,
          this.assign(
            intoId,
            "ensureSafeObject(" + this.computedMember(left, right) + ")"
          )
        );
        if (context) {
          context.name = right;
          context.computed = true;
        }
      } else {
        ensureSafeMemberName(ast.property.name);
        if (create) {
          this.if_(
            this.not(this.nonComputedMember(left, ast.property.name)),
            this.assign(this.nonComputedMember(left, ast.property.name), "{}")
          );
        }
        this.if_(
          left,
          this.assign(
            intoId,
            "ensureSafeObject(" +
              this.nonComputedMember(left, ast.property.name) +
              ")"
          )
        );
        if (context) {
          context.name = ast.property.name;
          context.computed = false;
        }
      }
      return intoId;
    case AST.CallExpression:
      let callContext, callee, args;
      if (ast.filter) {
        callee = this.filter(ast.callee.name);
        args = _.map(ast.arguments, arg => {
          return this.recurse(arg);
        });
        return callee + "(" + args + ")";
      } else {
        callContext = {};
        callee = this.recurse(ast.callee, callContext);
        args = _.map(ast.arguments, arg => {
          return "ensureSafeObject(" + this.recurse(arg) + ")";
        });
        if (callContext.name) {
          this.addEnsureSafeObject(callContext.context);
          if (callContext.computed) {
            callee = this.computedMember(callContext.context, callContext.name);
          } else {
            callee = this.nonComputedMember(
              callContext.context,
              callContext.name
            );
          }
        }
        this.addEnsureSafeFunction(callee);
        return (
          callee + "&&ensureSafeObject(" + callee + "(" + args.join(",") + "))"
        );
      }
      break;
    case AST.AssignmentExpression:
      const leftContext = {};
      this.recurse(ast.left, leftContext, true);
      let leftExpr;
      if (leftContext.computed) {
        leftExpr = this.computedMember(leftContext.context, leftContext.name);
      } else {
        leftExpr = this.nonComputedMember(
          leftContext.context,
          leftContext.name
        );
      }
      return this.assign(
        leftExpr,
        "ensureSafeObject(" + this.recurse(ast.right) + ")"
      );
    case AST.UnaryExpression:
      return (
        ast.operator + "(" + this.ifDefined(this.recurse(ast.argument), 0) + ")"
      );
    case AST.BinaryExpression:
      if (ast.operator === "+" || ast.operator === "-") {
        return (
          "(" +
          this.ifDefined(this.recurse(ast.left), 0) +
          ")" +
          ast.operator +
          "(" +
          this.ifDefined(this.recurse(ast.right), 0) +
          ")"
        );
      } else {
        return (
          "(" +
          this.recurse(ast.left) +
          ")" +
          ast.operator +
          "(" +
          this.recurse(ast.right) +
          ")"
        );
      }
    case AST.LogicalExpression:
      intoId = this.nextId();
      this.state.body.push(this.assign(intoId, this.recurse(ast.left)));
      this.if_(
        ast.operator === "&&" ? intoId : this.not(intoId),
        this.assign(intoId, this.recurse(ast.right))
      );
      return intoId;
    case AST.ConditionalExpression:
      intoId = this.nextId();
      const testId = this.nextId();
      this.state.body.push(this.assign(testId, this.recurse(ast.test)));
      this.if_(testId, this.assign(intoId, this.recurse(ast.consequent)));
      this.if_(
        this.not(testId),
        this.assign(intoId, this.recurse(ast.alternate))
      );
      return intoId;
  }
};

ASTCompiler.prototype.escape = function(value) {
  if (_.isString(value)) {
    return (
      "'" + value.replace(this.stringEscapeRegex, this.stringEscapeFn) + "'"
    );
  } else if (_.isNull(value)) {
    return "null";
  } else {
    return value;
  }
};
ASTCompiler.prototype.stringEscapeRegex = /[^a-zA-Z0-9]/g;
ASTCompiler.prototype.stringEscapeFn = function(c) {
  return "\\u" + ("0000" + c.charCodeAt(0).toString(16)).slice(-4);
};
ASTCompiler.prototype.computedMember = function(left, right) {
  return "(" + left + ")[" + right + "]";
};
ASTCompiler.prototype.nonComputedMember = function(left, right) {
  return "(" + left + ")." + right;
};
ASTCompiler.prototype.if_ = function(test, consequent) {
  this.state.body.push("if(", test, "){", consequent, "}");
};
ASTCompiler.prototype.assign = function(id, value) {
  return id + "=" + value + ";";
};
ASTCompiler.prototype.nextId = function(skip) {
  const id = "v" + this.state.nextId++;
  if (!skip) {
    this.state.vars.push(id);
  }
  return id;
};
ASTCompiler.prototype.not = function(e) {
  return "!(" + e + ")";
};
ASTCompiler.prototype.getHasOwnProperty = function(object, property) {
  return object + "&&(" + this.escape(property) + " in " + object + ")";
};
ASTCompiler.prototype.addEnsureSafeMemberName = function(expr) {
  this.state.body.push("ensureSafeMemberName(" + expr + ");");
};
ASTCompiler.prototype.addEnsureSafeObject = function(expr) {
  this.state.body.push("ensureSafeObject(" + expr + ");");
};
ASTCompiler.prototype.addEnsureSafeFunction = function(expr) {
  this.state.body.push("ensureSafeFunction(" + expr + ");");
};
ASTCompiler.prototype.ifDefined = function(value, defaultValue) {
  return "ifDefined(" + value + "," + this.escape(defaultValue) + ")";
};
ASTCompiler.prototype.filter = function(name) {
  if (!this.state.filters.hasOwnProperty("name")) {
    this.state.filters[name] = this.nextId(true);
  }
  return this.state.filters[name];
};
ASTCompiler.prototype.filterPrefix = function() {
  if (_.isEmpty(this.state.filters)) {
    return "";
  } else {
    const parts = _.map(this.state.filters, (varName, filterName) => {
      return varName + "=" + "filter(" + this.escape(filterName) + ")";
    });
    return "var " + parts.join(",") + ";";
  }
};

function Parser(lexer) {
  this.lexer = lexer;
  this.ast = new AST(this.lexer);
  this.astCompiler = new ASTCompiler(this.ast);
}

Parser.prototype.parse = function(text) {
  return this.astCompiler.compile(text);
};
