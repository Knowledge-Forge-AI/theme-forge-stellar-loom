import { createHash } from "node:crypto";
import {
  MAX_PNG_BYTES,
  MIN_IMAGE_DIMENSION,
  MAX_IMAGE_DIMENSION,
} from "./constants.js";
import { ThemeExchangeValidationError } from "./types.js";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

export interface PngValidationResult {
  readonly width: number;
  readonly height: number;
  readonly byteCount: number;
  readonly pngDigest: string;
}

/**
 * Validate PNG buffer signature, IHDR chunk, dimensions, and size bounds
 */
export function validatePngBuffer(bytes: Buffer): PngValidationResult {
  if (bytes.length < 24) {
    throw new ThemeExchangeValidationError("PNG buffer too short to contain IHDR header", "INVALID_PNG");
  }

  if (bytes.length > MAX_PNG_BYTES) {
    throw new ThemeExchangeValidationError(
      `PNG buffer exceeds maximum size of ${MAX_PNG_BYTES} bytes (was ${bytes.length})`,
      "IMAGE_TOO_LARGE"
    );
  }

  if (!bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new ThemeExchangeValidationError("Invalid PNG signature", "INVALID_PNG");
  }

  const ihdrLength = bytes.readUInt32BE(8);
  if (ihdrLength !== 13) {
    throw new ThemeExchangeValidationError("IHDR chunk length must be 13", "INVALID_PNG");
  }

  const ihdrType = bytes.toString("ascii", 12, 16);
  if (ihdrType !== "IHDR") {
    throw new ThemeExchangeValidationError("First PNG chunk must be IHDR", "INVALID_PNG");
  }

  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);

  if (width < MIN_IMAGE_DIMENSION || width > MAX_IMAGE_DIMENSION) {
    throw new ThemeExchangeValidationError(
      `PNG width ${width} outside permitted bounds [${MIN_IMAGE_DIMENSION}..${MAX_IMAGE_DIMENSION}]`,
      "IMAGE_DIMENSIONS_OUT_OF_BOUNDS"
    );
  }

  if (height < MIN_IMAGE_DIMENSION || height > MAX_IMAGE_DIMENSION) {
    throw new ThemeExchangeValidationError(
      `PNG height ${height} outside permitted bounds [${MIN_IMAGE_DIMENSION}..${MAX_IMAGE_DIMENSION}]`,
      "IMAGE_DIMENSIONS_OUT_OF_BOUNDS"
    );
  }

  const hash = createHash("sha256").update(bytes).digest("hex");
  return {
    width,
    height,
    byteCount: bytes.length,
    pngDigest: `sha256:${hash}`,
  };
}

/**
 * Validate base64-encoded PNG string
 */
export function validatePngBase64(base64: string): PngValidationResult {
  if (typeof base64 !== "string" || !base64) {
    throw new ThemeExchangeValidationError("PNG base64 string must be non-empty", "INVALID_PNG");
  }

  // Canonical base64 check: must not contain whitespace or line breaks
  if (/\s/.test(base64)) {
    throw new ThemeExchangeValidationError("PNG base64 contains whitespace or newlines", "NON_CANONICAL_BASE64");
  }

  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(base64) || base64.length % 4 !== 0) {
    throw new ThemeExchangeValidationError("PNG base64 has invalid formatting or padding", "NON_CANONICAL_BASE64");
  }

  const buf = Buffer.from(base64, "base64");
  // Check roundtrip canonical base64 representation
  if (buf.toString("base64") !== base64) {
    throw new ThemeExchangeValidationError("PNG base64 is not canonically encoded", "NON_CANONICAL_BASE64");
  }

  return validatePngBuffer(buf);
}
