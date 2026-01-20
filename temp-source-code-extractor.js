const fs = require('fs');
const path = require('path');

/**
 * Extract source code from all files in the /src directory
 * and format it according to the specified pattern
 */

// Configuration
const SRC_DIR = path.join(__dirname, 'src');
const OUTPUT_FILE = path.join(__dirname, 'source-code.txt');
const EXCLUDED_DIRS = ['node_modules', 'dist', '.git', 'test', 'spec'];
const EXCLUDED_EXTENSIONS = ['.map', '.snap', '.md', '.json'];

/**
 * Check if a file should be included based on directory and extension
 */
function shouldIncludeFile(filePath) {
  const relativePath = path.relative(SRC_DIR, filePath);
  
  // Check for excluded directories in the path
  for (const excludedDir of EXCLUDED_DIRS) {
    if (relativePath.includes(`${path.sep}${excludedDir}${path.sep}`) || 
        relativePath.startsWith(`${excludedDir}${path.sep}`)) {
      return false;
    }
  }
  
  // Check for excluded file extensions
  const ext = path.extname(filePath);
  if (EXCLUDED_EXTENSIONS.includes(ext.toLowerCase())) {
    return false;
  }
  
  return true;
}

/**
 * Get all files recursively from a directory
 */
function getAllFiles(dirPath, arrayOfFiles = []) {
  const files = fs.readdirSync(dirPath);

  files.forEach((file) => {
    const fullPath = path.join(dirPath, file);
    
    if (fs.statSync(fullPath).isDirectory()) {
      // Skip excluded directories
      if (!EXCLUDED_DIRS.includes(file)) {
        getAllFiles(fullPath, arrayOfFiles);
      }
    } else {
      if (shouldIncludeFile(fullPath)) {
        arrayOfFiles.push(fullPath);
      }
    }
  });

  return arrayOfFiles;
}

/**
 * Format the file content for output
 */
function formatFileContent(filePath, content) {
  // Convert Windows paths to Unix-style for consistency
  const relativePath = path.relative(__dirname, filePath).replace(/\\/g, '/');
  return `/${relativePath}\n${content}\n\n`;
}

/**
 * Main function to extract and compile source code
 */
function extractSourceCode() {
  console.log(`Starting extraction from: ${SRC_DIR}`);
  
  // Check if src directory exists
  if (!fs.existsSync(SRC_DIR)) {
    console.error(`Error: ${SRC_DIR} directory not found!`);
    console.error('Make sure you run this script from the root of your NestJS project.');
    process.exit(1);
  }
  
  // Get all files from src directory
  const allFiles = getAllFiles(SRC_DIR);
  
  if (allFiles.length === 0) {
    console.error('No source files found in the /src directory.');
    process.exit(1);
  }
  
  console.log(`Found ${allFiles.length} source files to process.`);
  
  // Process each file and build the output
  let outputContent = '';
  
  allFiles.forEach((filePath, index) => {
    try {
      console.log(`Processing (${index + 1}/${allFiles.length}): ${path.relative(SRC_DIR, filePath)}`);
      
      const content = fs.readFileSync(filePath, 'utf8');
      outputContent += formatFileContent(filePath, content);
    } catch (error) {
      console.error(`Error reading file ${filePath}:`, error.message);
    }
  });
  
  // Write the output file
  try {
    fs.writeFileSync(OUTPUT_FILE, outputContent, 'utf8');
    console.log(`\n✅ Successfully created ${OUTPUT_FILE}`);
    console.log(`Total files processed: ${allFiles.length}`);
  } catch (error) {
    console.error(`Error writing output file:`, error.message);
    process.exit(1);
  }
}

// Run the extraction
extractSourceCode();