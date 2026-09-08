import { lstat, mkdir, readdir, realpath, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, normalize, relative, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import type { GeneratePackageResult, WritePackageOptions, WritePackageResult } from "./types.js";

export class FilesystemSafetyError extends Error {
  constructor(message: string, public readonly code: string = "FILESYSTEM_SAFETY_ERROR") {
    super(message);
    this.name = "FilesystemSafetyError";
  }
}

function validateMemberPath(relPath: string): void {
  if (typeof relPath !== "string" || relPath.length === 0) {
    throw new FilesystemSafetyError(
      "Invalid member path: path cannot be empty",
      "INVALID_MEMBER_PATH"
    );
  }
  if (isAbsolute(relPath)) {
    throw new FilesystemSafetyError(
      `Invalid member path '${relPath}': absolute paths are forbidden`,
      "INVALID_MEMBER_PATH"
    );
  }
  const normalized = normalize(relPath).replace(/\\/g, "/");
  if (normalized.startsWith("../") || normalized === ".." || normalized.startsWith("/")) {
    throw new FilesystemSafetyError(
      `Invalid member path '${relPath}': path traversal is forbidden`,
      "INVALID_MEMBER_PATH"
    );
  }
  const segments = relPath.split(/[/\\]/);
  for (const seg of segments) {
    if (!seg || seg === "." || seg === "..") {
      throw new FilesystemSafetyError(
        `Invalid member path '${relPath}': unnormalized or traversal segment '${seg}'`,
        "INVALID_MEMBER_PATH"
      );
    }
  }
}

export async function writeThemePackage(
  result: GeneratePackageResult,
  outDir: string,
  options?: WritePackageOptions
): Promise<WritePackageResult> {
  // 1. Explicitly reject overwrite if requested
  if (options?.overwrite) {
    throw new FilesystemSafetyError(
      "The overwrite option is not supported for package generation. Theme packages must be written to an absent or empty directory.",
      "OVERWRITE_NOT_SUPPORTED"
    );
  }

  // 2. Validate member paths before any filesystem mutation
  const normalizedPaths = new Set<string>();
  for (const relPath of result.files.keys()) {
    validateMemberPath(relPath);
    const norm = normalize(relPath);
    if (normalizedPaths.has(norm)) {
      throw new FilesystemSafetyError(
        `Duplicate member target after normalization: '${norm}'`,
        "INVALID_MEMBER_PATH"
      );
    }
    normalizedPaths.add(norm);
  }

  // 3. Inspect destination directly before ancestor walk
  const targetPath = resolve(outDir);
  let destStat;
  let destExists = false;
  try {
    destStat = await lstat(targetPath);
    destExists = true;
  } catch (err: any) {
    if (err.code === "ENOENT" || err.code === "ENOTDIR") {
      destExists = false;
    } else {
      throw new FilesystemSafetyError(
        `Failed to inspect target destination '${targetPath}': ${err.message}`,
        "TARGET_INSPECTION_FAILED"
      );
    }
  }

  if (destExists && destStat) {
    if (destStat.isSymbolicLink()) {
      throw new FilesystemSafetyError(
        `Refusing to write to symbolic link directory: '${targetPath}'`,
        "SYMLINK_REJECTED"
      );
    }
    if (!destStat.isDirectory()) {
      throw new FilesystemSafetyError(
        `Output path exists and is not a directory: '${targetPath}'`,
        "NOT_A_DIRECTORY"
      );
    }
    const existingEntries = await readdir(targetPath);
    if (existingEntries.length > 0) {
      throw new FilesystemSafetyError(
        `Target directory is not empty: '${targetPath}'. Theme packages must be written to an absent or empty directory.`,
        "DIRECTORY_NOT_EMPTY"
      );
    }
  }

  // 4. Resolve intermediate symlinks and determine canonical parent
  let canonicalParent: string;
  let canonicalTarget: string;
  const dirsCreatedByInvocation: string[] = [];

  if (destExists) {
    canonicalTarget = await realpath(targetPath);
    canonicalParent = dirname(canonicalTarget);
  } else {
    let existingAncestor = dirname(targetPath);
    const segmentsToCreate: string[] = [];
    while (true) {
      try {
        const st = await lstat(existingAncestor);
        if (st.isSymbolicLink()) {
          let real: string;
          try {
            real = await realpath(existingAncestor);
          } catch {
            throw new FilesystemSafetyError(
              `Ancestor path is a dangling symlink: '${existingAncestor}'`,
              "SYMLINK_REJECTED"
            );
          }
          const realSt = await lstat(real);
          if (!realSt.isDirectory()) {
            throw new FilesystemSafetyError(
              `Ancestor path resolves to non-directory: '${existingAncestor}'`,
              "NOT_A_DIRECTORY"
            );
          }
          break;
        }
        if (!st.isDirectory()) {
          throw new FilesystemSafetyError(
            `Ancestor path exists and is not a directory: '${existingAncestor}'`,
            "NOT_A_DIRECTORY"
          );
        }
        break;
      } catch (err: any) {
        if (err instanceof FilesystemSafetyError) {
          throw err;
        }
        if (err.code === "ENOENT" || err.code === "ENOTDIR") {
          segmentsToCreate.unshift(basename(existingAncestor));
          const parent = dirname(existingAncestor);
          if (parent === existingAncestor) {
            throw new FilesystemSafetyError(
              `No existing ancestor directory found for '${targetPath}'`,
              "FILESYSTEM_SAFETY_ERROR"
            );
          }
          existingAncestor = parent;
        } else {
          throw new FilesystemSafetyError(
            `Failed to inspect ancestor path '${existingAncestor}': ${err.message}`,
            "TARGET_INSPECTION_FAILED"
          );
        }
      }
    }

    const canonicalAncestor = await realpath(existingAncestor);
    let currentCanonical = canonicalAncestor;
    for (const seg of segmentsToCreate) {
      currentCanonical = join(currentCanonical, seg);
      try {
        await mkdir(currentCanonical);
        dirsCreatedByInvocation.push(currentCanonical);
      } catch (err: any) {
        if (err.code !== "EEXIST") {
          for (let i = dirsCreatedByInvocation.length - 1; i >= 0; i--) {
            await rmdir(dirsCreatedByInvocation[i]!).catch(() => {});
          }
          throw new FilesystemSafetyError(
            `Failed to create parent directory '${currentCanonical}': ${err.message}`,
            "FILESYSTEM_SAFETY_ERROR"
          );
        }
      }
    }
    canonicalParent = currentCanonical;
    canonicalTarget = join(canonicalParent, basename(targetPath));
  }

  // 5. Stage all files into an isolated staging directory
  const nonce = randomBytes(6).toString("hex");
  const stagingDir = join(
    canonicalParent,
    `.${basename(canonicalTarget)}.staging.${Date.now()}.${nonce}`
  );

  try {
    await mkdir(stagingDir);
  } catch (err: any) {
    for (let i = dirsCreatedByInvocation.length - 1; i >= 0; i--) {
      await rmdir(dirsCreatedByInvocation[i]!).catch(() => {});
    }
    throw new FilesystemSafetyError(
      `Failed to create staging directory '${stagingDir}': ${err.message}`,
      "FILESYSTEM_SAFETY_ERROR"
    );
  }

  const filesWritten: string[] = [];
  try {
    for (const [relPath, content] of result.files.entries()) {
      const stagePath = join(stagingDir, relPath);
      await mkdir(dirname(stagePath), { recursive: true });
      await writeFile(stagePath, content, "utf8");
      filesWritten.push(relPath);
    }
  } catch (err: any) {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    for (let i = dirsCreatedByInvocation.length - 1; i >= 0; i--) {
      await rmdir(dirsCreatedByInvocation[i]!).catch(() => {});
    }
    throw new FilesystemSafetyError(
      `Failed to stage package files: ${err.message}`,
      "FILESYSTEM_SAFETY_ERROR"
    );
  }

  // 6. Publication
  if (!destExists) {
    let pubExists = false;
    try {
      await lstat(canonicalTarget);
      pubExists = true;
    } catch (err: any) {
      if (err.code !== "ENOENT") {
        await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
        for (let i = dirsCreatedByInvocation.length - 1; i >= 0; i--) {
          await rmdir(dirsCreatedByInvocation[i]!).catch(() => {});
        }
        throw new FilesystemSafetyError(
          `Failed to verify destination at publication: ${err.message}`,
          "TARGET_INSPECTION_FAILED"
        );
      }
    }

    if (pubExists) {
      await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
      for (let i = dirsCreatedByInvocation.length - 1; i >= 0; i--) {
        await rmdir(dirsCreatedByInvocation[i]!).catch(() => {});
      }
      throw new FilesystemSafetyError(
        `Conflicting filesystem entity appeared at destination before publication: '${canonicalTarget}'`,
        "DESTINATION_CONFLICT"
      );
    }

    try {
      await rename(stagingDir, canonicalTarget);
    } catch (err: any) {
      await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
      for (let i = dirsCreatedByInvocation.length - 1; i >= 0; i--) {
        await rmdir(dirsCreatedByInvocation[i]!).catch(() => {});
      }
      throw new FilesystemSafetyError(
        `Failed to publish package to destination: ${err.message}`,
        "FILESYSTEM_SAFETY_ERROR"
      );
    }
  } else {
    // Existing empty directory: move files into target while tracking created items
    let pubEntries: string[];
    try {
      pubEntries = await readdir(canonicalTarget);
    } catch (err: any) {
      await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
      throw new FilesystemSafetyError(
        `Failed to inspect destination at publication: ${err.message}`,
        "TARGET_INSPECTION_FAILED"
      );
    }

    if (pubEntries.length > 0) {
      await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
      throw new FilesystemSafetyError(
        `Target directory is no longer empty: '${canonicalTarget}'`,
        "DIRECTORY_NOT_EMPTY"
      );
    }

    const itemsCreatedInTarget: { path: string; isDir: boolean }[] = [];
    try {
      for (const relPath of filesWritten) {
        const srcFile = join(stagingDir, relPath);
        const destFile = join(canonicalTarget, relPath);
        const destDir = dirname(destFile);
        if (destDir !== canonicalTarget) {
          const dirParts = relative(canonicalTarget, destDir).split(/[/\\]/);
          let cur = canonicalTarget;
          for (const part of dirParts) {
            cur = join(cur, part);
            try {
              await mkdir(cur);
              itemsCreatedInTarget.push({ path: cur, isDir: true });
            } catch (e: any) {
              if (e.code !== "EEXIST") throw e;
            }
          }
        }
        await rename(srcFile, destFile);
        itemsCreatedInTarget.push({ path: destFile, isDir: false });
      }
      await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    } catch (err: any) {
      for (let i = itemsCreatedInTarget.length - 1; i >= 0; i--) {
        const item = itemsCreatedInTarget[i]!;
        if (item.isDir) {
          await rmdir(item.path).catch(() => {});
        } else {
          await rm(item.path, { force: true }).catch(() => {});
        }
      }
      await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
      throw new FilesystemSafetyError(
        `Failed to move package files into destination: ${err.message}`,
        "FILESYSTEM_SAFETY_ERROR"
      );
    }
  }

  return {
    outDir,
    filesWritten: filesWritten.sort(),
    filesPruned: [], // Reserved: always empty (package generation requires absent or empty destination)
    result,
  };
}
