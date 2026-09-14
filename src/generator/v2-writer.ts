import { compareUtf8 } from "../design-exchange-v2/canonical.js";
import { lstat, mkdir, mkdtemp, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join, parse, resolve } from "node:path";
import { FilesystemSafetyError } from "./writer.js";

export type GeneratedFile = string | Uint8Array;

/** Reject user symlinks, allowing only the operating system's root aliases. */
export async function inspectV2Path(path: string): Promise<string> {
  let absolute = resolve(path);
  const systemRoots = new Set(["/var", "/tmp", "/etc", "/home", "/run"]);
  let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split("/")) {
    current = join(current, part);
    try {
      const st = await lstat(current);
      if (st.isSymbolicLink()) {
        if (!systemRoots.has(current)) throw new FilesystemSafetyError("Symbolic link in output path", "SYMLINK_REJECTED");
        const canonical = await realpath(current);
        absolute = canonical + absolute.slice(current.length);
        current = canonical;
      } else if (!st.isDirectory()) {
        throw new FilesystemSafetyError("Output path is not a directory", "NOT_A_DIRECTORY");
      }
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  return absolute;
}

/** Whole-directory publication: no per-member replacement or rollback of user files.
 * Like ordinary filesystem APIs, this assumes ancestors are not adversarially
 * replaced during a syscall; it is not a hostile-same-user confinement primitive.
 */
export async function writeV2Files(files: ReadonlyMap<string, GeneratedFile>, outDir: string, options?: { overwrite?: boolean | undefined }): Promise<string[]> {
  if (options?.overwrite) throw new FilesystemSafetyError("V2 output requires an absent or empty destination; overwrite is unsupported", "OVERWRITE_NOT_SUPPORTED");
  const snapshots = new Map<string, Buffer>();
  for (const [name, content] of files) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9._/-]*$/.test(name) || name.split("/").some(p => !p || p === "." || p === "..")) {
      throw new FilesystemSafetyError("Invalid generated member", "INVALID_MEMBER_PATH");
    }
    snapshots.set(name, Buffer.from(content));
  }
  const target = await inspectV2Path(outDir);
  let initial: Awaited<ReturnType<typeof lstat>> | undefined;
  try {
    initial = await lstat(target);
    if (!initial.isDirectory() || (await readdir(target)).length) throw new FilesystemSafetyError("Destination must be absent or empty", "DIRECTORY_NOT_EMPTY");
  } catch (error: any) { if (error.code !== "ENOENT") throw error; }
  await mkdir(dirname(target), { recursive: true });
  await inspectV2Path(dirname(target));
  const stage = await mkdtemp(join(dirname(target), ".tfsl-v2-"));
  try {
    for (const [name, bytes] of snapshots) {
      await mkdir(dirname(join(stage, name)), { recursive: true });
      await writeFile(join(stage, name), bytes, { flag: "wx" });
    }
    await inspectV2Path(target);
    try {
      const now = await lstat(target);
      if (!initial || now.dev !== initial.dev || now.ino !== initial.ino || !now.isDirectory() || (await readdir(target)).length) {
        throw new FilesystemSafetyError("Destination changed before publication", "DESTINATION_CONFLICT");
      }
    } catch (error: any) {
      if (error.code !== "ENOENT" || initial) throw error;
    }
    // POSIX rename refuses replacing a nonempty directory or a nondirectory.
    await rename(stage, target);
  } finally {
    await rm(stage, { recursive: true, force: true });
  }
  return [...snapshots.keys()].sort(compareUtf8);
}
