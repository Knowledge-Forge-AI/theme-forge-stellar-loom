#!/usr/bin/env node
import { runBatch } from "../dist/batch.js";

const code = await runBatch();
process.exit(code);
