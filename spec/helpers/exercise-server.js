const assert = require("node:assert/strict");
const fs = require("node:fs");
const { position, applyEdits, editsFor, sameUri } = require("./project");
const at = (client, fixture, method, fragment, inside = 0, extra = {}) =>
  client.request(method, {
    textDocument: { uri: fixture.uri },
    position: position(fixture.text, fragment, inside),
    ...extra,
  });
const analyzed = async (client, fixture) => {
  client.open(fixture.uri, "dart", fixture.text);
  await client.waitFor(
    () =>
      client
        .messages("textDocument/publishDiagnostics")
        .some(({ params }) => sameUri(params.uri, fixture.uri)),
    "Dart project analysis",
    60000,
  );
};
const exerciseIntelligence = async (client, fixture) => {
  const results = [],
    check = (name, condition) => {
      assert.ok(condition, `${name} returned no usable result`);
      results.push(name);
    };
  await analyzed(client, fixture);
  const completion = await at(client, fixture, "textDocument/completion", "add(1,2)", 2);
  check(
    "completion",
    (completion.items || completion).some(({ label }) => label.startsWith("add")),
  );
  const hover = await at(client, fixture, "textDocument/hover", "add(1,2)", 1);
  check("hover", JSON.stringify(hover).includes("Add two values"));
  const signature = await at(client, fixture, "textDocument/signatureHelp", "add(1,2)", 6);
  check(
    "signature",
    signature.signatures.some(({ label }) => label.includes("left") && label.includes("right")),
  );
  const definitions = await at(client, fixture, "textDocument/definition", "add(1,2)", 1);
  check(
    "definition",
    definitions.some((item) => sameUri(item.uri || item.targetUri, fixture.uri)),
  );
  const references = await at(client, fixture, "textDocument/references", "int add", 5, {
    context: { includeDeclaration: true },
  });
  check("references", references.length >= 5);
  const symbols = await client.request("textDocument/documentSymbol", {
    textDocument: { uri: fixture.uri },
  });
  check(
    "document symbols",
    symbols.some(({ name }) => name === "Calculator"),
  );
  const workspace = await client.request("workspace/symbol", { query: "ProjectDependency" });
  check(
    "local pub dependency symbols",
    workspace.some(({ name }) => name === "ProjectDependency"),
  );
  const format = await client.request("textDocument/formatting", {
    textDocument: { uri: fixture.uri },
    options: { tabSize: 2, insertSpaces: true },
  });
  check("formatting", format.length && applyEdits(fixture.text, format) !== fixture.text);
  const hints = await client.request("textDocument/inlayHint", {
    textDocument: { uri: fixture.uri },
    range: {
      start: { line: 0, character: 0 },
      end: { line: fixture.text.split("\n").length - 1, character: 0 },
    },
  });
  check("inlay hints", hints.length > 0);
  const tokens = await client.request("textDocument/semanticTokens/full", {
    textDocument: { uri: fixture.uri },
  });
  check("semantic tokens", tokens.data.length > 0 && tokens.data.length % 5 === 0);
  const callees = await at(client, fixture, "textDocument/prepareCallHierarchy", "int add", 5);
  check("prepare call hierarchy", callees.length > 0);
  const incoming = await client.request("callHierarchy/incomingCalls", { item: callees[0] });
  check(
    "incoming calls",
    incoming.some(({ from }) => from.name === "wrapper"),
  );
  const callers = await at(client, fixture, "textDocument/prepareCallHierarchy", "int wrapper", 6);
  const outgoing = await client.request("callHierarchy/outgoingCalls", { item: callers[0] });
  check(
    "outgoing calls",
    outgoing.some(({ to }) => to.name === "add"),
  );
  const parents = await at(
    client,
    fixture,
    "textDocument/prepareTypeHierarchy",
    "abstract class BaseCalculator",
    18,
  );
  check("prepare type hierarchy", parents.length > 0);
  const children = await client.request("typeHierarchy/subtypes", { item: parents[0] });
  check(
    "subtypes",
    children.some(({ name }) => name === "Calculator"),
  );
  const child = await at(
    client,
    fixture,
    "textDocument/prepareTypeHierarchy",
    "class Calculator",
    8,
  );
  const supers = await client.request("typeHierarchy/supertypes", { item: child[0] });
  check(
    "supertypes",
    supers.some(({ name }) => name === "BaseCalculator"),
  );
  const folds = await client.request("textDocument/foldingRange", {
    textDocument: { uri: fixture.uri },
  });
  check(
    "folding ranges",
    folds.some(({ startLine, endLine }) => startLine < endLine),
  );
  const selections = await client.request("textDocument/selectionRange", {
    textDocument: { uri: fixture.uri },
    positions: [position(fixture.text, "add(1,2)", 1)],
  });
  check("selection ranges", selections[0].parent);
  return results;
};
const exerciseUnicodeRename = async (client, fixture) => {
  await analyzed(client, fixture);
  const start = position(fixture.text, "add(4, 5)");
  const prepared = await at(client, fixture, "textDocument/prepareRename", "add(4, 5)", 1),
    range = prepared.range || prepared;
  assert.equal(range.start.character, start.character);
  assert.equal(range.end.character, start.character + 3);
  const refs = await at(client, fixture, "textDocument/references", "add(4, 5)", 1, {
      context: { includeDeclaration: true },
    }),
    occurrence = refs.find(
      ({ uri, range }) => sameUri(uri, fixture.uri) && range.start.line === start.line,
    );
  assert.equal(occurrence.range.start.character, start.character);
  const closed = refs.find(({ uri }) => sameUri(uri, fixture.linkedUri));
  assert.equal(closed.range.start.character, position(fixture.linkedText, "add(9, 1)").character);
  const rename = await at(client, fixture, "textDocument/rename", "add(4, 5)", 1, {
    newName: "sumValues",
  });
  const changed = applyEdits(fixture.text, editsFor(rename, fixture.uri)),
    linked = applyEdits(fixture.linkedText, editsFor(rename, fixture.linkedUri));
  assert.ok(changed.includes("var unicode = '😀'; var result = sumValues(4, 5)"));
  assert.ok(changed.includes("int sumValues"));
  assert.ok(linked.includes("return sumValues(9, 1)"));
  fs.writeFileSync(fixture.linkedPath, linked);
  await client.change(fixture.uri, changed, 2);
  const symbols = await client.request("textDocument/documentSymbol", {
    textDocument: { uri: fixture.uri },
  });
  assert.ok(symbols.some(({ name }) => name === "sumValues"));
  return [
    "UTF-16 prepare rename",
    "UTF-16 references",
    "closed-file Unicode references",
    "UTF-16 rename edits",
    "symbols after applying rename",
  ];
};
const exerciseDiagnosticEdits = async (client, fixture) => {
  client.open(fixture.uri, "dart", "void main() { int value = 'wrong'; print(value); }\n");
  const diagnostics = await client.waitFor(
    () =>
      client
        .messages("textDocument/publishDiagnostics")
        .find(
          ({ params }) =>
            sameUri(params.uri, fixture.uri) &&
            params.diagnostics.some(({ code }) => code === "invalid_assignment"),
        )?.params.diagnostics,
    "Dart type diagnostics",
  );
  assert.ok(diagnostics.length);
  let marker = client.notifications.length;
  await client.change(fixture.uri, "void main() { int value = 1; print(value); }\n", 2);
  await client.waitFor(
    () =>
      client.notifications
        .slice(marker)
        .some(
          ({ method, params }) =>
            method === "textDocument/publishDiagnostics" &&
            sameUri(params.uri, fixture.uri) &&
            !params.diagnostics.some(({ code }) => code === "invalid_assignment"),
        ),
    "cleared Dart type error",
  );
  const code = "void main() { var value = 1; print(value); }\n";
  marker = client.notifications.length;
  await client.change(fixture.uri, code, 3);
  const style = await client.waitFor(
    () =>
      client.notifications
        .slice(marker)
        .find(
          ({ method, params }) =>
            method === "textDocument/publishDiagnostics" &&
            sameUri(params.uri, fixture.uri) &&
            params.diagnostics.some(({ code }) => code === "prefer_final_locals"),
        )?.params.diagnostics,
    "project analyzer lint",
  );
  const diagnostic = style.find(({ code }) => code === "prefer_final_locals"),
    actions = await client.request("textDocument/codeAction", {
      textDocument: { uri: fixture.uri },
      range: diagnostic.range,
      context: { diagnostics: style, only: ["quickfix"] },
    });
  const action = actions.find(({ title, edit }) => edit && title.toLowerCase().includes("final"));
  assert.ok(action, "Analyzer final-local quick fix missing");
  const fixed = applyEdits(code, editsFor(action.edit, fixture.uri));
  assert.ok(fixed.includes("final value"));
  await client.change(fixture.uri, fixed, 4);
  return [
    "type diagnostics",
    "diagnostic clearing",
    "project-configured lint",
    "direct quick-fix edits",
  ];
};
module.exports = { exerciseIntelligence, exerciseUnicodeRename, exerciseDiagnosticEdits };
if (require.main === module) {
  const { LiveLspClient } = require("./live-lsp-client"),
    { createProject, prepareProject, removeProject } = require("./project"),
    manifest = require("../../package.json");
  globalThis.lumine = {
    config: {
      get(key) {
        const field = key.slice(9);
        return field === "serverPath"
          ? process.env.DART_PATH
          : manifest.configSchema[field]?.default;
      },
    },
  };
  let adapter;
  require("../../lib/main").consumeIde({
    registerAdapter(value) {
      adapter = value;
      return { dispose() {} };
    },
    reportMissingServer() {
      throw Error("Dart missing");
    },
  });
  (async () => {
    for (const exercise of [exerciseIntelligence, exerciseDiagnosticEdits, exerciseUnicodeRename]) {
      const fixture = createProject(),
        client = new LiveLspClient(adapter, fixture.rootPath);
      try {
        await prepareProject(fixture, process.env.DART_PATH);
        console.log("SERVER", await client.start());
        console.log("COVERED", await exercise(client, fixture));
      } catch (error) {
        console.error(client.stderr);
        console.error(client.notifications);
        throw error;
      } finally {
        await client.stop();
        removeProject(fixture.rootPath);
      }
    }
  })().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
