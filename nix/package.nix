# First-party Theme Forge Stellar Loom Nix source package derivation (TFSB71P3).
# Consumes clean public source inputs, filters out node_modules/dist/git metadata/private siblings,
# compiles TypeScript via buildNpmPackage, generates catalog build evidence,
# and installs immutable, cwd-independent Nix Node wrappers.
{ lib
, stdenv
, buildNpmPackage
, nodejs_22
, makeWrapper
, source
, npmDepsHash ? "sha256-DLKVAiTQf9h3kUT4wAIVHML759NmPQ2isRUXTM+CRjw="
}:

let
  supportedSystems = [
    "aarch64-darwin"
    "aarch64-linux"
    "x86_64-linux"
  ];

  rawSrc = source;

  # Filter source to guarantee clean, deterministic, reproducible input:
  # Exclude node_modules, prior dist outputs, .git, caches, and Nix metadata.
  filteredSrc = lib.cleanSourceWith {
    src = rawSrc;
    name = "stellar-loom-source";
    filter = path: type:
      let
        base = baseNameOf (toString path);
        rel = lib.removePrefix (toString rawSrc + "/") (toString path);
      in
        !(base == "node_modules"
          || base == "dist"
          || base == ".git"
          || base == "result"
          || base == ".cache"
          || base == ".DS_Store"
          || (rel == "nix" || lib.hasPrefix "nix/" rel)
          || rel == "flake.nix"
          || rel == "flake.lock");
  };

in
assert lib.elem stdenv.hostPlatform.system supportedSystems;
buildNpmPackage {
  pname = "theme-forge-stellar-loom";
  version = (builtins.fromJSON (builtins.readFile (source + "/package.json"))).version;

  src = filteredSrc;

  nodejs = nodejs_22;
  inherit npmDepsHash;

  npmFlags = [ "--ignore-scripts" ];
  npmBuildScript = "build";

  nativeBuildInputs = [ makeWrapper ];

  # Catalog evidence build binds compiled output and catalog member digests
  postBuild = ''
    node tools/build-catalog-evidence.mjs
  '';

  # Disable automatic shebang patching so that catalog member hashes remain intact
  dontPatchShebangs = true;

  installPhase = ''
    runHook preInstall

    local pkgRoot="$out/lib/node_modules/@knowledge-forge-ai/theme-forge-stellar-loom"
    mkdir -p "$pkgRoot" "$out/bin"

    # 1. Distributable compiled JavaScript and type definitions
    cp -r dist "$pkgRoot/dist"

    # 2. Executable entry scripts (preserved regular files, exact bytes and hashes)
    mkdir -p "$pkgRoot/bin"
    cp bin/tfsl.js "$pkgRoot/bin/tfsl.js"
    cp bin/tfsl-batch.js "$pkgRoot/bin/tfsl-batch.js"
    chmod 755 "$pkgRoot/bin/tfsl.js" "$pkgRoot/bin/tfsl-batch.js"

    # 3. Protocol schemas and documentation
    cp -r protocol "$pkgRoot/protocol"

    # 4. Examples
    cp -r examples "$pkgRoot/examples"

    # 5. Metadata and legal notices
    cp package.json "$pkgRoot/package.json"
    cp NOTICE "$pkgRoot/NOTICE"
    cp COMMERCIAL-LICENSE.md "$pkgRoot/COMMERCIAL-LICENSE.md"
    cp LICENSE "$pkgRoot/LICENSE"
    cp README.md "$pkgRoot/README.md"
    if [ -f CHANGELOG.md ]; then cp CHANGELOG.md "$pkgRoot/CHANGELOG.md"; fi

    # 6. Immutable, cwd-independent Nix Node wrappers for tfsl and tfsl-batch
    makeWrapper ${nodejs_22}/bin/node "$out/bin/tfsl" \
      --add-flags "$pkgRoot/bin/tfsl.js" \
      --unset NODE_PATH --unset NODE_OPTIONS

    makeWrapper ${nodejs_22}/bin/node "$out/bin/tfsl-batch" \
      --add-flags "$pkgRoot/bin/tfsl-batch.js" \
      --unset NODE_PATH --unset NODE_OPTIONS

    # 7. Verification: Ensure catalog-build-evidence hashes match installed files exactly
    node -e '
      const fs = require("node:fs");
      const crypto = require("node:crypto");
      const path = require("node:path");
      const root = process.argv[1];
      const manifestPath = path.join(root, "dist/catalog-build-evidence.json");
      if (!fs.existsSync(manifestPath)) {
        throw new Error("dist/catalog-build-evidence.json missing from installed root");
      }
      const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
      for (const m of manifest.members) {
        const full = path.join(root, m.path);
        if (!fs.existsSync(full)) {
          throw new Error("Missing catalog member: " + m.path);
        }
        const bytes = fs.readFileSync(full);
        const sha = crypto.createHash("sha256").update(bytes).digest("hex");
        if (sha !== m.sha256) {
          throw new Error("Catalog hash mismatch for " + m.path + ": expected " + m.sha256 + " but got " + sha);
        }
      }
      console.log("Verified " + manifest.members.length + " catalog members intact at installed root.");
    ' "$pkgRoot"

    runHook postInstall
  '';

  postFixup = ''
    local pkgRoot="$out/lib/node_modules/@knowledge-forge-ai/theme-forge-stellar-loom"
    # Defensive check to guarantee no fixup step modified catalog members
    node -e '
      const fs = require("node:fs");
      const crypto = require("node:crypto");
      const path = require("node:path");
      const root = process.argv[1];
      const manifest = JSON.parse(fs.readFileSync(path.join(root, "dist/catalog-build-evidence.json"), "utf8"));
      for (const m of manifest.members) {
        const bytes = fs.readFileSync(path.join(root, m.path));
        const sha = crypto.createHash("sha256").update(bytes).digest("hex");
        if (sha !== m.sha256) {
          throw new Error("PostFixup catalog hash mismatch for " + m.path + ": expected " + m.sha256 + " but got " + sha);
        }
      }
      console.log("PostFixup verified " + manifest.members.length + " catalog members intact.");
    ' "$pkgRoot"
  '';

  passthru = {
    nodejs = nodejs_22;
  };

  meta = with lib; {
    description = "Starlight theme-builder backend, library, and CLI";
    homepage = "https://github.com/Knowledge-Forge-AI/theme-forge-stellar-loom";
    license = licenses.agpl3Plus;
    platforms = supportedSystems;
    mainProgram = "tfsl";
  };
}
