# ide-dart

Provide Dart language intelligence through the SDK analysis server.

Connects the [Dart SDK's built-in language server](https://github.com/dart-lang/sdk/blob/main/pkg/analysis_server/tool/lsp_spec/README.md) to ide-client for Dart source files, including Flutter projects with a compatible SDK and resolved dependencies.

## Features

- **Intelligence**: completion, documentation, signatures and analyzer diagnostics.
- **Navigation**: definitions, implementations, types, references and document or workspace symbols.
- **Hierarchies**: incoming and outgoing calls, type ancestors and descendants.
- **Editing**: symbol rename, analyzer quick fixes, refactorings and SDK formatting.
- **Annotations**: semantic highlighting, inferred type hints, parameter names, folding and selection ranges.
- **Project support**: reads pubspec.yaml, analysis_options.yaml and resolved pub package configuration.
- **Managed installation**: downloads and verifies the complete stable Dart SDK, including its analyzer, runtime, formatter, pub tools, libraries and licenses.

## Installation

Install ide-dart, ide-client and language-dart from the Install tab, then install the feature frontends you want, such as autocomplete, linter, hover, refactor and code-format. Select the project's `dart` executable in **Dart Path**, or use **Manage Servers** to download the full SDK. Managed builds support Windows, macOS and Linux on x64 and ARM64. The SDK is kept privately under the editor's language-servers directory; it is not added to your system PATH.

An explicit Dart Path wins over the managed SDK. Without either, the adapter checks `DART_SDK`, `FLUTTER_ROOT`, the project's `.fvm/flutter_sdk` cache and PATH. On Windows, select `dart.exe` inside the SDK rather than the Flutter batch wrapper. For Flutter, select `flutter/bin/cache/dart-sdk/bin/dart` (or `dart.exe`); a managed standalone Dart SDK does not install Flutter.

## Usage

Open the project root and a Dart file. Run the project's usual `dart pub get` or `flutter pub get` after changing dependencies. The adapter launches `dart language-server --protocol=lsp` and keeps project dependencies, SDK constraints, analyzer plugins and `analysis_options.yaml` authoritative. Choose the Dart SDK that matches your project's constraints, especially for Flutter and version-managed projects.

Completion includes unimported libraries by default; complete function calls with required arguments is off by default. Inlay hints and dependency symbols follow the analyzer's enabled defaults. TODO diagnostics are off. Formatting preferences belong in `analysis_options.yaml`, including `formatter.page_width`; the adapter does not replace project formatter configuration.

Code lenses require Dart-specific client navigation or test commands that this editor does not advertise, so they are disabled. Standard workspace edits and server-executable code actions remain available. Flutter outlines, closing-label notifications, hot reload, debugging and the Dart Tooling Daemon are separate integrations and are not advertised by this adapter.

The adapter's MIT license covers its JavaScript integration. A managed SDK retains the Dart project's own license and notices in the downloaded distribution.

## Development

Run `npm ci`, `npm run lint`, `npm run format:check`, `npm audit --audit-level=high` and `npm pack --dry-run`. Run `lumine --test spec` for the editor suite. Real tests use Dart SDK 3.13.5, an offline local pub dependency, both hierarchy APIs, diagnostics, quick fixes, Unicode rename in open and closed files, feature gates and unload/reload. Set `DART_PATH` to a portable SDK executable, `DART_VERSION` to its exact version, `REQUIRE_DART_LSP=1` to require real tests and `REQUIRE_DART_MANAGED_INSTALL=1` to exercise a fresh full-SDK install through the hub.

## Contributing

Got ideas to make this package better, found a bug, or want to help add new features? Just drop your thoughts on GitHub. Any feedback is welcome!
