#!/usr/bin/env node

/**
 * PR Linter - Repository-specific pattern scanner
 * 
 * Scans source files for common risky patterns and emits GitHub Actions annotations.
 * Configurable via FAIL_ON_WARNINGS environment variable.
 */

const fs = require('fs');
const path = require('path');

// Configuration
const FAIL_ON_WARNINGS = process.env.FAIL_ON_WARNINGS === 'true';
const SOURCE_DIR = path.join(__dirname, '..', 'apps', 'desktop', 'src');

// Pattern definitions
const PATTERNS = [
  {
    name: 'hardcoded-ptyid-zero',
    regex: /ptyId:\s*0\b/g,
    message: 'Hardcoded ptyId: 0 detected. This may cause issues with terminal instances.',
    severity: 'warning',
  },
  {
    name: 'empty-catch-block',
    regex: /catch\s*(\([^)]*\))?\s*\{\s*\}/g,
    message: 'Empty catch block detected. Consider logging the error or adding a comment explaining why it\'s safe to ignore. Note: Blocks with only whitespace are considered empty.',
    severity: 'warning',
  },
  {
    name: 'prevent-default-in-onselect',
    regex: /onSelect\s*=\s*\{?[\s\S]*?e\.preventDefault\(\)/g,
    message: 'e.preventDefault() in onSelect handler detected. This may interfere with expected menu behavior.',
    severity: 'warning',
  },
  {
    name: 'threadcounter-usage',
    regex: /threadCounter/g,
    message: 'threadCounter usage detected. Ensure this counter is properly initialized and synchronized across the application.',
    severity: 'warning',
  },
  {
    name: 'suspicious-loadautoruncommand',
    regex: /loadAutoRunCommand\([^)]*\|\|\s*['"]/g,
    message: 'Suspicious loadAutoRunCommand fallback detected. Verify that the fallback value is intentional.',
    severity: 'warning',
  },
];

// Track issues found
let warningCount = 0;
let errorCount = 0;

/**
 * Recursively scan directory for TypeScript/JavaScript files
 */
function scanDirectory(dir) {
  const files = fs.readdirSync(dir);
  
  for (const file of files) {
    const filePath = path.join(dir, file);
    const stat = fs.statSync(filePath);
    
    if (stat.isDirectory()) {
      // Skip node_modules and other common directories
      if (!['node_modules', 'dist', 'build', '.git'].includes(file)) {
        scanDirectory(filePath);
      }
    } else if (stat.isFile() && /\.(ts|tsx|js|jsx)$/.test(file)) {
      scanFile(filePath);
    }
  }
}

/**
 * Scan a single file for patterns
 */
function scanFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');
  const relativePath = path.relative(process.cwd(), filePath);
  
  for (const pattern of PATTERNS) {
    // Reset regex lastIndex to ensure it starts from the beginning for each file
    pattern.regex.lastIndex = 0;
    
    let match;
    while ((match = pattern.regex.exec(content)) !== null) {
      // Find line number
      const beforeMatch = content.substring(0, match.index);
      const lineNumber = beforeMatch.split('\n').length;
      
      // Calculate column number (1-indexed)
      const lastNewlineIndex = beforeMatch.lastIndexOf('\n');
      const columnNumber = lastNewlineIndex === -1 
        ? match.index + 1  // First line
        : match.index - lastNewlineIndex + 1;  // Subsequent lines
      
      // Emit GitHub Actions annotation
      emitAnnotation({
        severity: pattern.severity,
        file: relativePath,
        line: lineNumber,
        col: columnNumber,
        message: `[${pattern.name}] ${pattern.message}`,
      });
      
      // Track counts
      if (pattern.severity === 'error') {
        errorCount++;
      } else {
        warningCount++;
      }
    }
  }
}

/**
 * Emit GitHub Actions annotation
 */
function emitAnnotation({ severity, file, line, col, message }) {
  // Format: ::warning file={file},line={line},col={col}::{message}
  console.log(`::${severity} file=${file},line=${line},col=${col}::${message}`);
}

/**
 * Main execution
 */
function main() {
  console.log('🔍 Running repository pattern scanner...\n');
  
  if (!fs.existsSync(SOURCE_DIR)) {
    console.error(`❌ Source directory not found: ${SOURCE_DIR}`);
    process.exit(1);
  }
  
  scanDirectory(SOURCE_DIR);
  
  console.log('\n📊 Scan Results:');
  console.log(`   Warnings: ${warningCount}`);
  console.log(`   Errors: ${errorCount}`);
  
  // Determine exit code
  if (errorCount > 0) {
    console.log('\n❌ Scan failed due to errors.');
    process.exit(1);
  } else if (FAIL_ON_WARNINGS && warningCount > 0) {
    console.log('\n❌ Scan failed due to warnings (FAIL_ON_WARNINGS=true).');
    process.exit(1);
  } else if (warningCount > 0) {
    console.log('\n⚠️  Scan completed with warnings.');
    process.exit(0);
  } else {
    console.log('\n✅ Scan completed successfully with no issues found.');
    process.exit(0);
  }
}

main();
