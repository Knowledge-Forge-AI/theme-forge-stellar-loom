#!/usr/bin/env node
import { runBatch } from "../dist/batch-catalog.js";

const code = await runBatch();
process.exit(code);
