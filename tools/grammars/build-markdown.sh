#!/usr/bin/env bash
# Builds the Markdown grammars as WebAssembly (phase 4, ADR 0023).
#
# No published package ships a Markdown grammar as .wasm, so we build it from the grammar's own
# generated C source (parser.c, scanner.c) with the tree-sitter CLI. Every input is pinned by version
# and SHA-256 and checked before use; the compile runs in a Flowcanvas-labelled container, so
# nothing is installed on the machine. The outputs' checksums live in markdown.sha256 and are
# committed with the .wasm files, so anyone can rebuild and compare.
#
#   tools/grammars/build-markdown.sh          build into packages/engine/grammars
#   tools/grammars/build-markdown.sh --check  rebuild in a temporary folder and compare the checksums
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
root="$(cd "$here/../.." && pwd)"
out="$root/packages/engine/grammars"
mode="${1:-build}"

# Inputs. Versions must match each other: the CLI pins wasi-sdk and binaryen in
# crates/loader/{wasi-sdk-version,binaryen-version} at its tag, and its ABI must be one
# web-tree-sitter (same version as the CLI) can load.
cli_version="0.27.2"
cli_url="https://github.com/tree-sitter/tree-sitter/releases/download/v${cli_version}/tree-sitter-cli-linux-x64.zip"
cli_sha256="b4233ecc4f0e648d6d8ccc4bac96c00c712ca1a5eb1e0ca7197d29b750bffa6d"

wasi_sdk_version="34.0"
wasi_sdk_url="https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-34/wasi-sdk-${wasi_sdk_version}-x86_64-linux.tar.gz"
wasi_sdk_sha256="b761e3a0721dbae9c09a0059e5fdb2bf917d1b4a8a7b430fb3b5aafb0984b2c4"

binaryen_version="132"
binaryen_url="https://github.com/WebAssembly/binaryen/releases/download/version_${binaryen_version}/binaryen-version_${binaryen_version}-x86_64-linux.tar.gz"
binaryen_sha256="195ddc94f9bc89f45abdabb0b9eea86023d727ba90eac8b35b80f2544fc30572"

markdown_version="0.3.2"
markdown_url="https://registry.npmjs.org/@tree-sitter-grammars/tree-sitter-markdown/-/tree-sitter-markdown-${markdown_version}.tgz"
# The npm tarball's SHA-256; it matches the registry's sha512 integrity for this version.
markdown_sha256="f582346e65479e1d6d025e9b785421f623eb549390c550899005fd6f7f37d739"

# The same base as the workspace image (workspace/image/Dockerfile), pinned by digest.
image="node:26-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072"

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

fetch() { # url sha256 file
  curl --fail --silent --show-error --location --output "$work/$3" "$1"
  echo "$2  $work/$3" | sha256sum --check --quiet
}

echo "Downloading and checking the pinned inputs…"
fetch "$cli_url" "$cli_sha256" cli.zip
fetch "$wasi_sdk_url" "$wasi_sdk_sha256" wasi-sdk.tar.gz
fetch "$binaryen_url" "$binaryen_sha256" binaryen.tar.gz
fetch "$markdown_url" "$markdown_sha256" markdown.tgz

mkdir -p "$work/cli" "$work/wasi-sdk" "$work/binaryen" "$work/markdown" "$work/out"
unzip -q "$work/cli.zip" -d "$work/cli"
tar -xzf "$work/wasi-sdk.tar.gz" -C "$work/wasi-sdk" --strip-components=1
tar -xzf "$work/binaryen.tar.gz" -C "$work/binaryen" --strip-components=1
tar -xzf "$work/markdown.tgz" -C "$work/markdown" --strip-components=1

echo "Compiling in a container…"
# No network: everything it needs is mounted read-only. The grammar is copied inside so the build
# writes nothing into the mounted source.
docker run --rm --label flowcanvas=grammar-build --network none --cpus 2 --memory 2g \
  --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -e TREE_SITTER_WASI_SDK_PATH=/opt/wasi-sdk -e TREE_SITTER_BINARYEN_PATH=/opt/binaryen \
  -v "$work/cli/tree-sitter:/usr/local/bin/tree-sitter:ro" \
  -v "$work/wasi-sdk:/opt/wasi-sdk:ro" -v "$work/binaryen:/opt/binaryen:ro" \
  -v "$work/markdown:/src:ro" -v "$work/out:/out" \
  "$image" sh -euc '
    cp -r /src /tmp/grammar
    for name in markdown markdown-inline; do
      tree-sitter build --wasm --output "/out/tree-sitter-$name.wasm" "/tmp/grammar/tree-sitter-$name"
    done
  '
cp "$work/markdown/LICENSE" "$work/out/LICENSE-tree-sitter-markdown"

(cd "$work/out" && sha256sum tree-sitter-markdown.wasm tree-sitter-markdown-inline.wasm) > "$work/markdown.sha256"

if [ "$mode" = "--check" ]; then
  if diff -u "$out/markdown.sha256" "$work/markdown.sha256"; then
    echo "The committed Markdown grammars match a fresh build."
  else
    echo "The committed Markdown grammars differ from a fresh build." >&2
    exit 1
  fi
else
  mkdir -p "$out"
  cp "$work/out/"* "$out/"
  cp "$work/markdown.sha256" "$out/markdown.sha256"
  echo "Built into $out:"
  cat "$out/markdown.sha256"
fi
