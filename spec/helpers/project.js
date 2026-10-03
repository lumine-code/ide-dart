const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { pathToFileURL, fileURLToPath } = require("node:url");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const source = `import 'package:project_dependency/project_dependency.dart';

/// A common calculation interface.
abstract class BaseCalculator {
  int calculate(int value);
}

/// Arithmetic helpers.
class Calculator extends BaseCalculator {
  @override
  int calculate(int value) => add(value, 2);
}

/// Add two values.
int add(int left, int right) => left + right;

int wrapper(int value) => add(value, 3);

void main() {
  var answer=add(1,2);
  var unicode = '😀'; var result = add(4, 5);
  print('$unicode $answer $result');
  print(ProjectDependency());
  print(Calculator().calculate(3));
}
`;
const position = (text, fragment, inside = 0) => {
  const index = text.indexOf(fragment);
  if (index < 0) throw new Error(`Missing fixture '${fragment}'.`);
  const lines = text.slice(0, index + inside).split("\n");
  return { line: lines.length - 1, character: lines.at(-1).length };
};
const offset = (text, point) =>
  text
    .split("\n")
    .slice(0, point.line)
    .reduce((sum, line) => sum + line.length + 1, 0) + point.character;
const applyEdits = (text, edits) => {
  for (const edit of [...edits].sort(
    (a, b) => offset(text, b.range.start) - offset(text, a.range.start),
  ))
    text =
      text.slice(0, offset(text, edit.range.start)) +
      edit.newText +
      text.slice(offset(text, edit.range.end));
  return text;
};
const sameUri = (left, right) => {
  const normalize = (uri) => {
    const p = fileURLToPath(uri);
    return process.platform === "win32" ? p.toLowerCase() : p;
  };
  return normalize(left) === normalize(right);
};
const editsFor = (edit, uri) => [
  ...Object.entries(edit.changes || {})
    .filter(([key]) => sameUri(key, uri))
    .flatMap(([, edits]) => edits),
  ...(edit.documentChanges || [])
    .filter((item) => item.textDocument?.uri && sameUri(item.textDocument.uri, uri))
    .flatMap((item) => item.edits || []),
];
const createProject = () => {
  const rootPath = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), "ide-dart-spec-"));
  fs.mkdirSync(path.join(rootPath, "lib"));
  fs.mkdirSync(path.join(rootPath, "dependency", "lib"), { recursive: true });
  const filePath = path.join(rootPath, "lib", "main.dart"),
    linkedPath = path.join(rootPath, "lib", "linked.dart"),
    linkedText =
      "import 'main.dart';\nint linked() { var text = '😀'; print(text); return add(9, 1); }\n";
  fs.writeFileSync(filePath, source);
  fs.writeFileSync(linkedPath, linkedText);
  fs.writeFileSync(
    path.join(rootPath, "pubspec.yaml"),
    "name: lumine_dart_fixture\nenvironment:\n  sdk: '>=3.0.0 <4.0.0'\ndependencies:\n  project_dependency:\n    path: dependency\n",
  );
  fs.writeFileSync(
    path.join(rootPath, "dependency", "pubspec.yaml"),
    "name: project_dependency\nenvironment:\n  sdk: '>=3.0.0 <4.0.0'\n",
  );
  fs.writeFileSync(
    path.join(rootPath, "dependency", "lib", "project_dependency.dart"),
    "class ProjectDependency {}\n",
  );
  fs.writeFileSync(
    path.join(rootPath, "analysis_options.yaml"),
    "linter:\n  rules:\n    - prefer_final_locals\n",
  );
  return {
    rootPath,
    filePath,
    linkedPath,
    linkedText,
    text: source,
    uri: pathToFileURL(filePath).href,
    linkedUri: pathToFileURL(linkedPath).href,
  };
};
const prepareProject = async (fixture, command) => {
  await promisify(execFile)(command, ["pub", "get", "--offline"], {
    cwd: fixture.rootPath,
    windowsHide: true,
    timeout: 60000,
    maxBuffer: 1024 * 1024,
  });
};
const removeProject = (rootPath) => {
  const temp = fs.realpathSync.native(os.tmpdir()),
    relative = path.relative(temp, path.resolve(rootPath));
  if (
    path.isAbsolute(relative) ||
    relative.startsWith("..") ||
    !relative.startsWith("ide-dart-spec-")
  )
    throw new Error(`Refusing unexpected scratch path: ${rootPath}`);
  fs.rmSync(rootPath, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
};
module.exports = {
  source,
  position,
  applyEdits,
  sameUri,
  editsFor,
  createProject,
  prepareProject,
  removeProject,
};
