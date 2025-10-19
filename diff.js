// https://stackoverflow.com/a/48968694/12646131
function saveFile(blob, filename) {
  if (window.navigator.msSaveOrOpenBlob) {
    window.navigator.msSaveOrOpenBlob(blob, filename);
  } else {
    const a = document.createElement("a");
    document.body.appendChild(a);
    const url = window.URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => {
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }, 0);
  }
}

// https://stackoverflow.com/a/50868276/12646131
const fromHexString = (hexString) =>
  Uint8Array.from(hexString.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));
const toHexString = (bytes) =>
  bytes.reduce((str, byte) => str + byte.toString(16).padStart(2, "0"), "");

function packBits(num, size) {
  let buffer = [];
  while (num != 0) {
    buffer.push(num & 255);
    num = num >> 8;
  }
  // pad with zeros
  buffer = Array(size - buffer.length)
    .fill(0)
    .concat(buffer);
  return buffer;
}

function unpackBits(buffer) {
  let num = 0;
  while (buffer.length > 0) {
    num = (num << 8) | buffer.pop();
  }

  return num;
}

// Configuration for chunked processing
const CHUNK_SIZE = 64 * 1024 * 1024; // 64MB chunks for better memory management

// State variables for chunked processing
let processingState = {
  isProcessing: false,
  originalFile: null,
  modifiedFile: null,
  patchFile: null,
  currentOperation: null
};

// Utility function to read a file chunk
async function readFileChunk(file, start, size) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const chunk = file.slice(start, start + size);
    
    reader.onload = () => resolve(new Uint8Array(reader.result));
    reader.onerror = () => reject(reader.error);
    
    reader.readAsArrayBuffer(chunk);
  });
}

// Calculate MD5 hash in chunks for large files
async function calculateMD5Hash(file) {
  const spark = new SparkMD5.ArrayBuffer();
  let currentChunk = 0;
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  
  while (currentChunk < totalChunks) {
    const start = currentChunk * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = await readFileChunk(file, start, end - start);
    
    spark.append(chunk.buffer);
    currentChunk++;
    
    // Update progress if callback exists
    if (window.updateProgress) {
      window.updateProgress(`Calculating checksum... ${Math.round((currentChunk / totalChunks) * 100)}%`);
    }
  }
  
  return spark.end();
}

async function tryGeneratePatch() {
  document.querySelector("#error-text").innerText = "";
  
  if (processingState.isProcessing) {
    document.querySelector("#error-text").innerText = "Processing in progress, please wait...";
    return;
  }

  if (document.querySelector("#original-file").files[0] == null) {
    document.querySelector("#error-text").innerText =
      "You have not uploaded the original file!";
    return;
  }
  if (document.querySelector("#modified-file").files[0] == null) {
    document.querySelector("#error-text").innerText =
      "You have not uploaded the modified file!";
    return;
  }

  processingState.isProcessing = true;
  processingState.originalFile = document.querySelector("#original-file").files[0];
  processingState.modifiedFile = document.querySelector("#modified-file").files[0];
  processingState.currentOperation = 'generate';
  
  try {
    // Validate file sizes
    validateFileSize(processingState.originalFile, 'generate');
    validateFileSize(processingState.modifiedFile, 'generate');
    
    await generatePatchChunked();
  } catch (error) {
    console.error("Error generating patch:", error);
    document.querySelector("#error-text").innerText = `Error generating patch: ${error.message}`;
  } finally {
    processingState.isProcessing = false;
    suggestGarbageCollection();
  }
}

async function tryApplyPatch() {
  document.querySelector("#error-text").innerText = "";
  
  if (processingState.isProcessing) {
    document.querySelector("#error-text").innerText = "Processing in progress, please wait...";
    return;
  }

  if (document.querySelector("#original-file").files[0] == null) {
    document.querySelector("#error-text").innerText =
      "You have not uploaded the original file!";
    return;
  }
  if (document.querySelector("#patch-file").files[0] == null) {
    document.querySelector("#error-text").innerText =
      "You have not uploaded the patch file!";
    return;
  }

  processingState.isProcessing = true;
  processingState.originalFile = document.querySelector("#original-file").files[0];
  processingState.patchFile = document.querySelector("#patch-file").files[0];
  processingState.currentOperation = 'apply';
  
  try {
    // Validate file sizes
    validateFileSize(processingState.originalFile, 'apply');
    validateFileSize(processingState.patchFile, 'apply');
    
    await applyPatchChunked();
  } catch (error) {
    console.error("Error applying patch:", error);
    document.querySelector("#error-text").innerText = `Error applying patch: ${error.message}`;
  } finally {
    processingState.isProcessing = false;
    suggestGarbageCollection();
  }
}

async function generatePatchChunked() {
  document.querySelector("#error-text").innerText = "";
  
  const originalFile = processingState.originalFile;
  const modifiedFile = processingState.modifiedFile;
  
  console.log(`Original file size: ${originalFile.size} bytes`);
  console.log(`Modified file size: ${modifiedFile.size} bytes`);
  console.log(`Patched file size will be: ${modifiedFile.size} bytes`);
  
  if (window.updateProgress) {
    window.updateProgress("Starting patch generation...");
  }

  // Calculate checksum of original file
  const checksum = await calculateMD5Hash(originalFile);
  console.log(`Original file checksum is ${checksum}`);

  // Create a blob stream for the patch file
  const patchChunks = [];
  const totalChunks = Math.ceil(modifiedFile.size / CHUNK_SIZE);
  let processedBytes = 0;

  // Process file in chunks
  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    const start = chunkIndex * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, modifiedFile.size);
    const chunkSize = end - start;

    // Read chunks from both files
    const modifiedChunk = await readFileChunk(modifiedFile, start, chunkSize);
    let originalChunk;
    
    if (start < originalFile.size) {
      const originalChunkSize = Math.min(chunkSize, originalFile.size - start);
      originalChunk = await readFileChunk(originalFile, start, originalChunkSize);
      
      // If original chunk is smaller, pad with zeros
      if (originalChunkSize < chunkSize) {
        const paddedOriginal = new Uint8Array(chunkSize);
        paddedOriginal.set(originalChunk);
        originalChunk = paddedOriginal;
      }
    } else {
      // Original file is smaller, create zero-filled chunk
      originalChunk = new Uint8Array(chunkSize);
    }

    // XOR the chunks
    const patchChunk = new Uint8Array(chunkSize);
    for (let i = 0; i < chunkSize; i++) {
      patchChunk[i] = originalChunk[i] ^ modifiedChunk[i];
    }

    patchChunks.push(patchChunk);
    processedBytes += chunkSize;

    // Update progress
    if (window.updateProgress) {
      const progress = Math.round((processedBytes / modifiedFile.size) * 100);
      window.updateProgress(`Generating patch... ${progress}%`);
    }

    // Allow UI to update and prevent browser freezing
    await new Promise(resolve => setTimeout(resolve, 0));
    
    // Suggest garbage collection for large files
    if (window.gc && chunkIndex % 10 === 0) {
      window.gc();
    }
  }

  // Create the final patch with metadata
  const totalPatchSize = modifiedFile.size + 20;
  const finalPatchChunk = new Uint8Array(20);
  
  // Add checksum (16 bytes)
  const checksumBytes = fromHexString(checksum);
  finalPatchChunk.set(checksumBytes, 0);
  
  // Add file size (4 bytes)
  const sizeBytes = packBits(modifiedFile.size, 4);
  finalPatchChunk.set(sizeBytes, 16);
  
  patchChunks.push(finalPatchChunk);

  // Create blob from chunks
  const blob = new Blob(patchChunks, { type: "application/octet-stream" });
  
  if (window.updateProgress) {
    window.updateProgress("Saving patch file...");
  }
  
  saveFile(blob, modifiedFile.name + "_patch.bin");
  
  if (window.updateProgress) {
    window.updateProgress("Patch generation complete!");
  }
}

async function applyPatchChunked() {
  document.querySelector("#error-text").innerText = "";
  
  const originalFile = processingState.originalFile;
  const patchFile = processingState.patchFile;
  
  if (window.updateProgress) {
    window.updateProgress("Reading patch metadata...");
  }

  // Read the last 20 bytes to get metadata
  const metadataBuffer = await readFileChunk(patchFile, patchFile.size - 20, 20);
  
  // Extract file size (last 4 bytes)
  const sizeBytes = Array.from(metadataBuffer.slice(16, 20));
  const patchedFileSize = unpackBits(sizeBytes);
  console.log(`Patched file size is ${patchedFileSize} bytes`);

  if (patchedFileSize == 0) {
    console.log("Patched file size cannot be zero");
    document.querySelector("#error-text").innerText =
      "Patched file size was zero! This usually indicates a corrupt or invalid patch file.";
    return;
  }

  // Extract checksum (first 16 bytes of metadata)
  const checksumFromPatch = toHexString(metadataBuffer.slice(0, 16));
  console.log(`Patch file expected original file checksum to be ${checksumFromPatch}`);
  
  // Calculate checksum of uploaded original file
  const checksumFromUpload = await calculateMD5Hash(originalFile);
  console.log(`Original file checksum is ${checksumFromUpload}`);

  if (checksumFromPatch != checksumFromUpload) {
    console.log("Checksums do not match!");
    document.querySelector("#error-text").innerHTML =
      `File checksums do not match! Make sure you have the correct original and patch files.<br>Original checksum: <code>${checksumFromUpload}</code><br>Patch file expected checksum: <code>${checksumFromPatch}</code>`;
    return;
  }

  console.log("Checksums match!");

  if (window.updateProgress) {
    window.updateProgress("Applying patch...");
  }

  // Process patch in chunks
  const modifiedChunks = [];
  const totalChunks = Math.ceil(patchedFileSize / CHUNK_SIZE);
  let processedBytes = 0;

  for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
    const start = chunkIndex * CHUNK_SIZE;
    const end = Math.min(start + CHUNK_SIZE, patchedFileSize);
    const chunkSize = end - start;

    // Read patch chunk (excluding metadata)
    const patchChunk = await readFileChunk(patchFile, start, chunkSize);
    
    // Read original chunk
    let originalChunk;
    if (start < originalFile.size) {
      const originalChunkSize = Math.min(chunkSize, originalFile.size - start);
      originalChunk = await readFileChunk(originalFile, start, originalChunkSize);
      
      // If original chunk is smaller, pad with zeros
      if (originalChunkSize < chunkSize) {
        const paddedOriginal = new Uint8Array(chunkSize);
        paddedOriginal.set(originalChunk);
        originalChunk = paddedOriginal;
      }
    } else {
      // Original file is smaller, create zero-filled chunk
      originalChunk = new Uint8Array(chunkSize);
    }

    // XOR to get modified chunk
    const modifiedChunk = new Uint8Array(chunkSize);
    for (let i = 0; i < chunkSize; i++) {
      modifiedChunk[i] = originalChunk[i] ^ patchChunk[i];
    }

    modifiedChunks.push(modifiedChunk);
    processedBytes += chunkSize;

    // Update progress
    if (window.updateProgress) {
      const progress = Math.round((processedBytes / patchedFileSize) * 100);
      window.updateProgress(`Applying patch... ${progress}%`);
    }

    // Allow UI to update
    await new Promise(resolve => setTimeout(resolve, 0));
    
    // Suggest garbage collection for large files
    if (window.gc && chunkIndex % 10 === 0) {
      window.gc();
    }
  }

  if (window.updateProgress) {
    window.updateProgress("Saving modified file...");
  }

  // Create blob from chunks
  const blob = new Blob(modifiedChunks, { type: "application/octet-stream" });
  
  // Remove anything from the filename after the last occurrence of "_patch"
  let filename = patchFile.name;
  saveFile(blob, filename.slice(0, filename.lastIndexOf("_patch")));
  
  if (window.updateProgress) {
    window.updateProgress("Patch application complete!");
  }
}

// Memory optimization utilities
function suggestGarbageCollection() {
  if (window.gc) {
    window.gc();
  }
}

// Add file size validation and warnings
function validateFileSize(file, operation) {
  const fileSize = file.size;
  const fileSizeGB = fileSize / (1024 * 1024 * 1024);
  
  console.log(`File size: ${fileSizeGB.toFixed(2)} GB`);
  
  // Warn for very large files
  if (fileSizeGB > 2) {
    const proceed = confirm(
      `Warning: This file is ${fileSizeGB.toFixed(2)} GB in size. ` +
      `Processing may take a significant amount of time and memory. ` +
      `For files larger than your available RAM, the browser may become unresponsive. ` +
      `Do you want to continue?`
    );
    if (!proceed) {
      throw new Error("Operation cancelled by user");
    }
  }
  
  // Info for moderately large files
  if (fileSizeGB > 0.5) {
    console.log(`Processing large file (${fileSizeGB.toFixed(2)} GB). This may take some time...`);
  }
}

function setTab(t) {
  // Note: The original setTab function referenced elements that don't exist in the current HTML
  // This is a placeholder for any tab functionality that might be added later
  console.log("setTab function called with:", t);
}
