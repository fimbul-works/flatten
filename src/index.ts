#!/usr/bin/env node
/**
 * Flatten Utility - Project File Collection Script
 *
 * A command-line utility for collecting project files based on glob patterns and copying them
 * to a single directory with flattened paths. This tool is especially useful for:
 * - Preparing codebases to share with AI assistants
 * - Bundling files for analysis or archival
 *
 * HOW IT WORKS:
 * 1. Reads glob patterns from a .flatten configuration file
 * 2. Finds all matching files (with support for inclusion and exclusion rules)
 * 3. Copies files to a target directory with flattened naming
 * 4. Preserves original path information by converting separators to underscores
 *
 * PATH TRANSFORMATION:
 * Files are renamed using a bijective (reversible) transformation:
 * - Directory separators (/ or \) become single underscores (_)
 * - Existing underscores in filenames are doubled (__)
 *
 * Examples:
 * - src/components/Button.tsx → src_components_Button.tsx
 * - lib/nav_bar.js → lib_nav__bar.js
 * - index.ts → index.ts
 *
 * CONFIGURATION:
 * The .flatten file uses gitignore-style patterns:
 * - Lines starting with # are comments
 * - Regular patterns include files (e.g., "src/components/*.js")
 * - Patterns starting with ! exclude files (e.g., "!**\/*.test.js")
 *
 * @author FimbulWorks <https://github.com/fimbul-works>
 * @version 1.0.0
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { basename, join, sep as pathSeparator, resolve } from "node:path";
import { globSync } from "glob";
import { minimatch } from "minimatch";

// ==================== CONFIGURATION CONSTANTS ====================

/** Configuration file name */
const FLATTEN_FILE = ".flatten";

/** Full path to the configuration file */
const FLATTEN_FILE_PATH = resolve(FLATTEN_FILE);

/** Default target directory name (current project folder + "-flatten-flattened" suffix) */
const DEFAULT_TARGET_PATH = join("..", `${basename(process.cwd())}-flatten-flattened`);

/** Maximum file size warning threshold (10MB) */
const LARGE_FILE_WARNING_SIZE = 10 * 1024 * 1024;

// ==================== COMMAND LINE ARGUMENT PARSING ====================

// Parse command line arguments (skip 'node' and script name)
const [, , ...args] = process.argv;

// Command line flags and options
let targetPath = DEFAULT_TARGET_PATH; // Target directory for flattened files
let cleanFirst = false; // Whether to clean the target directory before copying
let followSymlinks = false; // Whether to follow symbolic links
let verbose = false; // Whether to list all files as they are copied
let dryRun = false; // Whether to simulate the operation without copying
let respectGitignore = false; // Whether to automatically exclude .gitignore patterns
let maxFileSize: number | null = null; // Maximum file size to copy (in bytes)
let showStats = false; // Whether to show detailed statistics

// Collect any unrecognized arguments for error reporting
const unknownArgs: string[] = [];

// Collect the names of copied files and statistics
const copiedFiles: string[] = [];
const skippedFiles: string[] = [];
const errorFiles: string[] = [];
let totalBytes = 0;

/**
 * Display usage information and help text
 */
function printHelp(print = console.log): void {
  print("Flatten Utility - Project File Collection Tool v1.0.1");
  print("Usage: npx flatten [OPTIONS] [TARGET_PATH]");
  print("");
  print("OPTIONS:");
  print("  -i, --init          Initialize .flatten file");
  print("  -c, --clean         Clean target directory before copying files");
  print("  -s, --symlinks      Follow symbolic links (use with caution)");
  print("  -v, --verbose       Show each file as it's copied");
  print("  -n, --dry-run       Show what would be copied without copying");
  print("  -g, --gitignore     Respect .gitignore patterns");
  print("  --max-size SIZE     Maximum file size to copy (e.g., 1MB, 500KB)");
  print("  --stats             Show detailed statistics after operation");
  print("  -h, --help          Show this help message");
  print("");
  print("TARGET_PATH:");
  print(`  Directory to copy flattened files (default: "${DEFAULT_TARGET_PATH}")`);
  print("");
  print("CONFIGURATION:");
  print("  Create a .flatten file with glob patterns (one per line)");
  print("  Use # for comments and ! to exclude files");
  print("");
  print("EXAMPLES:");
  print("  npx flatten --init                 # Initialize .flatten file");
  print("  npx flatten --dry-run              # Preview what would be copied");
  print("  npx flatten --clean --stats        # Clean and show statistics");
  print("  npx flatten --gitignore --verbose  # Respect .gitignore patterns");
  print("  npx flatten --max-size 1MB         # Skip files larger than 1MB");
}

/**
 * Initialize the .flatten configuration file with default patterns
 */
function initializeFlattenFile(): void {
  if (existsSync(FLATTEN_FILE)) {
    console.error(`ERROR: Existing ${FLATTEN_FILE} file found! Will not overwrite.`);
    process.exit(1);
  }

  const initial = `# Flatten Configuration File
#
# List file patterns to include (one per line)
# Use # for comments and ! to exclude files

# Common project files
package.json
README.md

# Source code (adjust patterns for your project)
src/**/*.js
src/**/*.ts
src/**/*.jsx
src/**/*.tsx

# Configuration files
tsconfig.json
*.config.js
*.config.ts

# Exclusion rules (files to ignore)
!**/*.d.ts
!**/*.test.*
!**/*.spec.*
!**/node_modules/**
!**/.git/**
!**/dist/**
!**/build/**`;

  try {
    writeFileSync(FLATTEN_FILE_PATH, initial);
    console.log(`Created ${FLATTEN_FILE} with default patterns`);
    console.log("Edit the file to customize which files to include");
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`ERROR: Failed to create ${FLATTEN_FILE}: ${errorMessage}`);
  }
}

/**
 * Parse file size string to bytes (e.g., "1MB" -> 1048576)
 */
function parseFileSize(sizeStr: string): number {
  const units = { B: 1, KB: 1024, MB: 1024 * 1024, GB: 1024 * 1024 * 1024 };
  const match = sizeStr.match(/^(\d+(?:\.\d+)?)(B|KB|MB|GB)$/i);

  if (!match) {
    throw new Error(`Invalid file size format: ${sizeStr}. Use format like: 1MB, 500KB, 2GB`);
  }

  const [, size, unit] = match;
  return Math.floor(Number.parseFloat(size) * units[unit.toUpperCase() as keyof typeof units]);
}

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let size = bytes;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }

  return `${size.toFixed(unitIndex > 0 ? 1 : 0)}${units[unitIndex]}`;
}

/**
 * Load and parse .gitignore patterns
 */
function loadGitignorePatterns(): string[] {
  const gitignorePath = resolve(".gitignore");
  if (!existsSync(gitignorePath)) {
    return [];
  }

  const content = readFileSync(gitignorePath, "utf-8");
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

// ==================== COMMAND LINE ARGUMENT PROCESSING ====================

// Process each argument to identify flags and options
for (let i = 0; i < args.length; i++) {
  const arg = args[i];

  if (arg.startsWith("-")) {
    // Handle flag arguments (both short and long form)
    const flag = arg.slice(1).replace(/^-/, ""); // Remove leading dash(es)

    switch (flag) {
      case "i":
      case "init": {
        initializeFlattenFile();
        process.exit(0);
      }

      case "h":
      case "help":
        printHelp();
        process.exit(0);

      case "c":
      case "clean":
        cleanFirst = true;
        break;

      case "s":
      case "symlinks":
        followSymlinks = true;
        break;

      case "v":
      case "verbose":
        verbose = true;
        break;

      case "n":
      case "dry-run":
        dryRun = true;
        break;

      case "g":
      case "gitignore":
        respectGitignore = true;
        break;

      case "stats":
        showStats = true;
        break;

      case "max-size": {
        const sizeArg = args[++i];
        if (!sizeArg) {
          console.error("ERROR: --max-size requires a size argument (e.g., 1MB)");
          process.exit(1);
        }

        try {
          maxFileSize = parseFileSize(sizeArg);
        } catch (error) {
          console.error(`ERROR: ${error instanceof Error ? error.message : error}`);
          process.exit(1);
        }
        break;
      }

      default:
        // Collect unknown flags for error reporting
        unknownArgs.push(arg);
        break;
    }
  } else {
    // First non-flag argument is treated as the target path
    if (targetPath === DEFAULT_TARGET_PATH) {
      targetPath = arg.endsWith(pathSeparator) ? arg : `${arg}${pathSeparator}`; // Ensure trailing slash
    } else {
      // Additional non-flag arguments are invalid
      unknownArgs.push(arg);
    }
  }
}

// ==================== ARGUMENT VALIDATION ====================

// Validate arguments - exit if any unknown arguments were provided
if (unknownArgs.length) {
  console.error(`ERROR: Invalid arguments: ${unknownArgs.join(" ")}`);
  console.error("");
  printHelp(console.error);
  process.exit(1);
}

// ==================== MAIN EXECUTION ====================

// Ensure the .flatten configuration file exists
if (!existsSync(FLATTEN_FILE_PATH)) {
  console.error(`ERROR: No ${FLATTEN_FILE} file found.`);
  console.error(`Run 'npx flatten --init' to create one, or create it manually.`);
  process.exit(1);
}

// Create the target directory if it doesn't exist (unless dry run)
if (!dryRun) {
  if (!existsSync(targetPath)) {
    mkdirSync(targetPath, { recursive: true });
    if (verbose) {
      console.log(`Created target directory: ${targetPath}`);
    }
  }

  // Clean existing files from target directory if requested
  if (cleanFirst) {
    const filesToRemove = globSync(join(targetPath, "*.*"));
    if (filesToRemove.length > 0) {
      console.log(`Cleaning ${filesToRemove.length} existing files from ${targetPath}...`);
      for (const file of filesToRemove) {
        try {
          rmSync(file);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : String(error);
          console.error(`ERROR: Failed to remove "${file}": ${errorMessage}`);
          console.error("Cancelling...");
          process.exit(1);
        }
      }
    } else if (verbose) {
      console.log(`No existing files to clean in ${targetPath}`);
    }
  }
}

// Read and parse the .flatten configuration file
const configText = readFileSync(FLATTEN_FILE_PATH, "utf-8");

// Parse .flatten file contents with comprehensive cleaning
const flattenList = configText
  .split("\n")
  .map((line) => line.replace(/#.*$/gm, "")) // Remove comments (everything after #)
  .map((line) => line.trim()) // Remove leading/trailing whitespace
  .filter(Boolean); // Remove empty lines

// Validate that we have at least one rule
if (flattenList.length === 0) {
  console.error(`ERROR: No file patterns found in ${FLATTEN_FILE}`);
  console.error(`Add some glob patterns to the file, or run 'npx flatten --init' for examples.`);
  process.exit(1);
}

// Separate exclusion rules (starting with !) from inclusion rules
let denyRules = flattenList.filter((rule) => rule.startsWith("!")).map((rule) => rule.slice(1));
const copyRules = flattenList.filter((rule) => !rule.startsWith("!"));

// Add .gitignore patterns if requested
if (respectGitignore) {
  const gitignorePatterns = loadGitignorePatterns();
  if (gitignorePatterns.length > 0) {
    denyRules = [...denyRules, ...gitignorePatterns];
    if (verbose) {
      console.log(`  Added ${gitignorePatterns.length} patterns from .gitignore`);
    }
  }
}

if (dryRun) {
  console.log("DRY RUN - No files will be copied");
}

if (verbose) {
  console.log(`Found ${copyRules.length} inclusion rules and ${denyRules.length} exclusion rules`);
  if (maxFileSize) {
    console.log(`Maximum file size: ${formatBytes(maxFileSize)}`);
  }
}

// Execute all copy rules and accumulate the total number of files copied
const startTime = Date.now();
const totalFilesCopied = copyRules.reduce((acc, rule) => {
  return acc + runRule(rule, denyRules);
}, 0);
const endTime = Date.now();

// Report final results with statistics
if (verbose) {
  console.log("");
}
if (totalFilesCopied > 0) {
  const verb = dryRun ? "would be copied" : "copied";
  console.log(`✓ ${totalFilesCopied} files ${verb}${dryRun ? "" : ` to ${targetPath}`}`);
  if (!dryRun) {
    console.log(`  Total size: ${formatBytes(totalBytes)}`);
  }
} else {
  console.log(`⚠ No files ${dryRun ? "would be" : "were"} copied`);
  console.log(`  Check your patterns in ${FLATTEN_FILE} - they might not match any files`);
}

if (showStats || verbose) {
  console.log(`⏱ Operation took ${endTime - startTime}ms`);
  if (skippedFiles.length > 0) {
    console.log(`↩ Skipped ${skippedFiles.length} files (size limits, duplicates, etc.)`);
  }
  if (errorFiles.length > 0) {
    console.log(`✗ ${errorFiles.length} files had errors`);
  }
}

// ==================== UTILITY FUNCTIONS ====================

/**
 * Execute a single file inclusion rule by finding matching files and copying them
 */
function runRule(pattern: string, denyRules: string[] = []): number {
  // Find all files matching the glob pattern
  let matchingFiles = globSync(pattern, { follow: followSymlinks });

  if (verbose && matchingFiles.length > 0) {
    console.log(`\nPattern "${pattern}" matched ${matchingFiles.length} files`);
  }

  // Apply exclusion rules to filter out unwanted files using minimatch
  if (denyRules.length > 0) {
    for (const denyRule of denyRules) {
      const beforeCount = matchingFiles.length;
      matchingFiles = matchingFiles.filter((file) => !minimatch(file, denyRule));

      if (verbose && matchingFiles.length < beforeCount) {
        console.log(`  🛇 Exclusion "${denyRule}" filtered out ${beforeCount - matchingFiles.length} files`);
      }
    }
  }

  // If all files were filtered out by exclusion rules, nothing to copy
  if (matchingFiles.length === 0) {
    return 0;
  }

  let successfulCopies = 0;

  // Copy each file with bijective path transformation
  for (const sourceFile of matchingFiles) {
    try {
      // Check file size
      const stats = statSync(sourceFile);
      const fileSize = stats.size;

      // Skip if file exceeds size limit
      if (maxFileSize && fileSize > maxFileSize) {
        if (verbose) {
          console.log(`  ↩ Skipping large file "${sourceFile}" (${formatBytes(fileSize)})`);
        }
        skippedFiles.push(sourceFile);
        continue;
      }

      // Warn about large files
      if (fileSize > LARGE_FILE_WARNING_SIZE && verbose) {
        console.warn(`  ⚠ Large file warning: "${sourceFile}" (${formatBytes(fileSize)})`);
      }

      // Apply bijective transformation to create flat filename
      const flattenedFileName = sourceFile
        .replaceAll("_", "__") // Step 1: Escape existing underscores
        .split(pathSeparator) // Step 2: Split into path components
        .filter(Boolean) // Remove empty components
        .filter((component) => !["node_modules", "."].includes(component)) // Step 3: Filter unwanted
        .join("_"); // Step 4: Join with underscores

      const targetFilePath = join(targetPath, flattenedFileName);

      // Check if the file was already copied
      if (copiedFiles.includes(targetFilePath)) {
        if (verbose) {
          console.log(`  ↩ Skipping duplicate "${flattenedFileName}"`);
        }
        skippedFiles.push(sourceFile);
        continue;
      }

      if (dryRun) {
        // In dry run mode, just log what would be copied
        console.log(`  ✓ Would copy: "${sourceFile}" → "${flattenedFileName}" (${formatBytes(fileSize)})`);
        successfulCopies++;
        totalBytes += fileSize;
      } else {
        // Actually copy the file
        copyFileSync(sourceFile, targetFilePath);
        successfulCopies++;
        totalBytes += fileSize;
        copiedFiles.push(targetFilePath);

        if (verbose) {
          console.log(`  ✓ "${sourceFile}" → "${flattenedFileName}" (${formatBytes(fileSize)})`);
        }
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.warn(`  ✗ Failed to ${dryRun ? "analyze" : "copy"} "${sourceFile}": ${errorMessage}`);
      errorFiles.push(sourceFile);
    }
  }

  return successfulCopies;
}
