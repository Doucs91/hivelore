import { describe, expect, it } from "vitest";
import { parseFileAst } from "../src/ast-parser.js";

async function names(src: string, ext: string): Promise<string[]> {
  return ((await parseFileAst(src, ext)) ?? []).map((e) => e.name).sort();
}
async function kindOf(src: string, ext: string, name: string): Promise<string | undefined> {
  return ((await parseFileAst(src, ext)) ?? []).find((e) => e.name === name)?.kind;
}

describe("parseFileAst — TypeScript / JavaScript (real AST)", () => {
  it("extracts every export-declaration kind with the right kind", async () => {
    const src = [
      "export function add(a: number, b: number) { return a + b; }",
      "export class Widget {}",
      "export interface Shape { x: number }",
      "export type Id = string;",
      "export enum Color { Red }",
      "export const TAU = 6.28;",
    ].join("\n");
    expect(await names(src, ".ts")).toEqual(["Color", "Id", "Shape", "TAU", "Widget", "add"]);
    expect(await kindOf(src, ".ts", "add")).toBe("function");
    expect(await kindOf(src, ".ts", "Widget")).toBe("class");
    expect(await kindOf(src, ".ts", "Shape")).toBe("interface");
    expect(await kindOf(src, ".ts", "Id")).toBe("type");
    expect(await kindOf(src, ".ts", "Color")).toBe("enum");
    expect(await kindOf(src, ".ts", "TAU")).toBe("const");
  });

  it("handles a named default export and an anonymous default", async () => {
    expect(await names("export default class Widget {}", ".ts")).toEqual(["Widget"]);
    const anon = (await parseFileAst("const x = 1;\nexport default x + 1;", ".ts")) ?? [];
    expect(anon.find((e) => e.name === "default")?.kind).toBe("default");
  });

  it("detects a mid-line export sharing a line with a preceding statement (the regex miss)", async () => {
    const src = `import {App} from "./App"; export const inlineX = App;`;
    expect(await names(src, ".ts")).toEqual(["inlineX"]);
  });

  it("captures every binding in a multi-declarator export", async () => {
    expect(await names("export const a = 1, b = 2, c = 3;", ".ts")).toEqual(["a", "b", "c"]);
  });

  it("includes named re-exports (with aliases) but skips default and type-only exports", async () => {
    const src = [
      'export { foo, bar as baz } from "./mod";',
      'export { something as default } from "./other";',
      'export type { OnlyAType } from "./types";',
      "export { type InlineType, runtimeFn } from \"./mixed\";",
    ].join("\n");
    expect(await names(src, ".ts")).toEqual(["baz", "foo", "runtimeFn"]);
  });

  it("indexes CommonJS exports (the class of files the regex parser dropped)", async () => {
    const src = [
      "module.exports = { foo, bar: baz };",
      "exports.qux = 1;",
      "module.exports.zap = 2;",
    ].join("\n");
    expect(await names(src, ".cjs")).toEqual(["bar", "foo", "qux", "zap"]);
  });

  it("indexes a CJS single re-export / function / class assignment", async () => {
    expect(await names("module.exports = something;", ".js")).toEqual(["something"]);
    expect(await names("module.exports = function named() {};", ".js")).toEqual(["named"]);
    expect(await kindOf("module.exports = function named() {};", ".js", "named")).toBe("function");
    expect(await kindOf("module.exports = class Cls {};", ".js", "Cls")).toBe("class");
  });

  it("returns null for an extension with no vendored grammar (→ regex fallback)", async () => {
    expect(await parseFileAst("fun greet() {}", ".kt")).toBeNull();
  });
});

describe("parseFileAst — Python / Go / Rust / Java", () => {
  it("Python: module-level def/class only, skipping underscores and nested methods", async () => {
    const src = [
      "@app.route('/')",
      "def handler():",
      "    return 1",
      "",
      "class Service:",
      "    def method(self):",
      "        return 2",
      "",
      "def _private():",
      "    return 3",
    ].join("\n");
    expect(await names(src, ".py")).toEqual(["Service", "handler"]);
    expect(await kindOf(src, ".py", "Service")).toBe("class");
    expect(await kindOf(src, ".py", "handler")).toBe("function");
  });

  it("Go: exported (uppercase) functions and methods only", async () => {
    const src = ["func Exported() {}", "func unexported() {}", "func (s *Server) Handle() {}"].join("\n");
    expect(await names(src, ".go")).toEqual(["Exported", "Handle"]);
  });

  it("Rust: only pub items, with kind mapping", async () => {
    const src = [
      "pub fn open() {}",
      "fn closed() {}",
      "pub struct Config {}",
      "pub enum Mode { A }",
      "pub trait Run {}",
    ].join("\n");
    expect(await names(src, ".rs")).toEqual(["Config", "Mode", "Run", "open"]);
    expect(await kindOf(src, ".rs", "Config")).toBe("class");
    expect(await kindOf(src, ".rs", "Run")).toBe("interface");
  });

  it("Java: classes, interfaces, enums, records", async () => {
    const src = ["public class Foo {}", "interface Bar {}", "enum Baz { X }", "record Rec(int a) {}"].join("\n");
    expect(await names(src, ".java")).toEqual(["Bar", "Baz", "Foo", "Rec"]);
    expect(await kindOf(src, ".java", "Bar")).toBe("interface");
    expect(await kindOf(src, ".java", "Baz")).toBe("enum");
  });
});

describe("parseFileAst — Ruby / C# / PHP (newly delivered, previously phantom)", () => {
  it("Ruby: top-level defs + classes/modules, excluding instance methods", async () => {
    const src = ["def top_func", "end", "class Foo", "  def m", "  end", "end", "module Bar", "end"].join("\n");
    expect(await names(src, ".rb")).toEqual(["Bar", "Foo", "top_func"]);
    expect(await kindOf(src, ".rb", "Foo")).toBe("class");
    expect(await kindOf(src, ".rb", "top_func")).toBe("function");
  });

  it("C#: type declarations regardless of namespace nesting", async () => {
    const src = [
      "namespace N {",
      "  public class CsFoo { public void M(){} }",
      "  interface IBar {}",
      "  public enum Status { OK }",
      "  public record Pt(int X);",
      "}",
    ].join("\n");
    // M is a public method → now indexed alongside the types.
    expect(await names(src, ".cs")).toEqual(["CsFoo", "IBar", "M", "Pt", "Status"]);
    expect(await kindOf(src, ".cs", "Status")).toBe("enum");
    expect(await kindOf(src, ".cs", "Pt")).toBe("class");
    expect(await kindOf(src, ".cs", "M")).toBe("function");
  });

  it("PHP: top-level functions + class/interface/trait/enum, excluding methods", async () => {
    const src = [
      "<?php",
      "function topFn() {}",
      "class PhpFoo { function m(){} }",
      "interface IFace {}",
      "trait TMix {}",
      "enum Suit {}",
    ].join("\n");
    // `m` has no visibility modifier → public by default → indexed.
    expect(await names(src, ".php")).toEqual(["IFace", "PhpFoo", "Suit", "TMix", "m", "topFn"]);
    expect(await kindOf(src, ".php", "TMix")).toBe("interface");
    expect(await kindOf(src, ".php", "topFn")).toBe("function");
  });
});

describe("parseFileAst — public methods + Go types", () => {
  it("Java: indexes public methods, excluding private/protected/package-private", async () => {
    const src = [
      "public class Foo {",
      "  public void pub() {}",
      "  private void priv() {}",
      "  protected int prot() { return 1; }",
      "  void pkg() {}",
      "}",
    ].join("\n");
    expect(await names(src, ".java")).toEqual(["Foo", "pub"]);
    expect(await kindOf(src, ".java", "pub")).toBe("function");
  });

  it("C#: only explicitly public methods (default-private is excluded)", async () => {
    const src = [
      "namespace N { public class Foo {",
      "  public void Pub() {}",
      "  private void Priv() {}",
      "  void ImplicitPriv() {}",
      "} }",
    ].join("\n");
    expect(await names(src, ".cs")).toEqual(["Foo", "Pub"]);
  });

  it("PHP: public + visibility-less methods, excluding private/protected", async () => {
    const src = [
      "<?php class Foo {",
      "  public function pub() {}",
      "  private function priv() {}",
      "  function implicitPub() {}",
      "}",
    ].join("\n");
    expect(await names(src, ".php")).toEqual(["Foo", "implicitPub", "pub"]);
  });

  it("Go: indexes exported structs, interfaces and aliases (not lowercase types)", async () => {
    const src = [
      "package m",
      "type Config struct { X int }",
      "type Reader interface { Read() }",
      "type Id = int",
      "type lower struct {}",
      "func Exported() {}",
    ].join("\n");
    expect(await names(src, ".go")).toEqual(["Config", "Exported", "Id", "Reader"]);
    expect(await kindOf(src, ".go", "Config")).toBe("class");
    expect(await kindOf(src, ".go", "Reader")).toBe("interface");
    expect(await kindOf(src, ".go", "Id")).toBe("type");
  });
});
