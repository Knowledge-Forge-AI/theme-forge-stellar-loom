{
  description = "Theme Forge Stellar Loom - Starlight theme-builder backend, library, and CLI";

  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";
  };

  outputs = { self, nixpkgs }:
    let
      supportedSystems = [ "aarch64-darwin" "aarch64-linux" "x86_64-linux" ];
      forAllSystems = nixpkgs.lib.genAttrs supportedSystems;

      # Public-composition recipe: remapped to ./nix/package.nix at public repository root.
      packagePath = ./nix/package.nix;
      toolsDir = ./tools;
    in
    {
      packages = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
          loom = pkgs.callPackage packagePath {
            source = self;
          };
        in
        {
          default = loom;
          theme-forge-stellar-loom = loom;
          stellar-loom = loom;
        });

      apps = forAllSystems (system: {
        default = {
          type = "app";
          program = "${self.packages.${system}.default}/bin/tfsl";
        };
        tfsl = {
          type = "app";
          program = "${self.packages.${system}.theme-forge-stellar-loom}/bin/tfsl";
        };
        tfsl-batch = {
          type = "app";
          program = "${self.packages.${system}.theme-forge-stellar-loom}/bin/tfsl-batch";
        };
      });

      checks = forAllSystems (system:
        let
          pkgs = import nixpkgs { inherit system; };
          loom = self.packages.${system}.theme-forge-stellar-loom;
          installedPkgRoot = "${loom}/lib/node_modules/@knowledge-forge-ai/theme-forge-stellar-loom";
        in
        {
          theme-forge-stellar-loom = pkgs.runCommand "theme-forge-stellar-loom-check" {
            nativeBuildInputs = [ pkgs.nodejs_22 ];
          } ''
            WORK_DIR=$(mktemp -d)
            ${pkgs.nodejs_22}/bin/node "${toolsDir}/qualify-installed.mjs" \
                --package-root "${installedPkgRoot}" \
                --node "${pkgs.nodejs_22}/bin/node" \
                --cli "${loom}/bin/tfsl" \
                --tfsl-batch "${loom}/bin/tfsl-batch" \
                --work-dir "$WORK_DIR"
            mkdir -p $out
            touch $out/ok
          '';
          stellar-loom = self.checks.${system}.theme-forge-stellar-loom;

        });
    };
}
