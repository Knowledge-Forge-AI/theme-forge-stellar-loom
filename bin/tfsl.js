#!/usr/bin/env node
import { runCli } from "../dist/cli-catalog.js";

const code = await runCli(process.argv);
process.exit(code);
