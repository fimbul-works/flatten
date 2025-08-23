# Flatten - Project File Collection Utility

[![npm version](https://badge.fury.io/js/%40fimbul-works%2Fflatten.svg)](https://www.npmjs.com/package/@fimbul-works/flatten)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
A command-line utility that collects project files based on glob patterns and flattens them into a single directory. Perfect for preparing codebases to share with AI assistants, creating project bundles, or organizing files for analysis.

## Why Flatten?

When working with AI assistants on coding projects, you often need to share multiple files from different directories. Instead of copying and pasting individual files or dealing with complex folder structures, **Flatten** creates a clean, single-directory view of your project while preserving all path information.

## Quick Start

```bash
npm install --save-dev @fimbul-works/flatten

# Use directly with npx
npx flatten --help
```

### Basic Usage

```bash
# Initialize configuration
flatten --init

# Preview what would be copied
flatten --dry-run

# Copy files to default location
flatten

# Copy with custom target directory
flatten ./my-flattened-project/
```

## How It Works

Flatten uses a **bijective transformation** to convert file paths into flat filenames while preserving all directory information:

| Original Path | Flattened Name |
|---------------|----------------|
| `src/components/Button.tsx` | `src_components_Button.tsx` |
| `lib/nav_bar.js` | `lib_nav__bar.js` |
| `utils/api/client.ts` | `utils_api_client.ts` |
| `index.ts` | `index.ts` |

**Transformation Rules:**
- Existing underscores in filenames → double underscore (`__`)
- Directory separators (`/` or `\`) → single underscore (`_`)
- Path information is fully preserved and reversible

*Do note that **Flatten** does not currently have an option to reverse the process.*

## Configuration

Create a `.flatten` file in your project root with glob patterns:

```bash
# Initialize with sensible defaults
flatten --init
```

### Example `.flatten` configuration:

```bash
# Flatten Configuration File
#
# List file patterns to include (one per line)
# Use # for comments and ! to exclude files

# Essential project files
package.json
README.md

# Source code
src/**/*.js
src/**/*.ts
src/**/*.jsx
src/**/*.tsx
lib/**/*.js

# Configuration files
tsconfig.json
*.config.js
*.config.ts
.env.example

# Exclusion rules (files to ignore)
!**/*.d.ts
!**/*.test.*
!**/*.spec.*
!**/node_modules/**
!**/.git/**
!**/dist/**
!**/build/**
```

## Command Line Options

```bash
flatten [OPTIONS] [TARGET_PATH]
```

### Core Options
- `-i, --init` - Initialize `.flatten` configuration file
- `-c, --clean` - Clean target directory before copying
- `-n, --dry-run` - Preview what would be copied without copying
- `-v, --verbose` - Show detailed progress and file information

### Advanced Options
- `-s, --symlinks` - Follow symbolic links (use with caution)
- `-g, --gitignore` - Automatically respect `.gitignore` patterns
- `--max-size SIZE` - Skip files larger than specified size (e.g., `1MB`, `500KB`)
- `--stats` - Show detailed operation statistics
- `-h, --help` - Display help information

### Examples

```bash
# Preview with verbose output
flatten --dry-run --verbose

# Clean target and respect gitignore
flatten --clean --gitignore

# Skip large files and show stats
flatten --max-size 1MB --stats

# Full cleanup with progress
flatten --clean --verbose --stats ./output/
```

## 📄 License

MIT

---

Built with ❤️ by [FimbulWorks](https://github.com/fimbul-works)
