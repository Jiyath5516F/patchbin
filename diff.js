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

const originalReader = new FileReader();
const modifiedReader = new FileReader();
const patchReader = new FileReader();

let originalLoaded = false;
let modifiedLoaded = false;
let patchLoaded = false;

function attemptGeneratePatch() {
  if (originalLoaded && modifiedLoaded) {
    originalLoaded = false;
    modifiedLoaded = false;
    generatePatch();
  }
}

function attemptApplyPatch() {
  if (originalLoaded && patchLoaded) {
    originalLoaded = false;
    patchLoaded = false;
    applyPatch();
  }
}

function tryGeneratePatch() {
  document.querySelector("#error-text").innerText = "";
  originalLoaded = false;
  modifiedLoaded = false;

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

  originalReader.readAsArrayBuffer(
    document.querySelector("#original-file").files[0],
  );
  modifiedReader.readAsArrayBuffer(
    document.querySelector("#modified-file").files[0],
  );

  originalReader.onload = () => {
    originalLoaded = true;
    attemptGeneratePatch();
  };

  modifiedReader.onload = () => {
    modifiedLoaded = true;
    attemptGeneratePatch();
  };
}

function tryApplyPatch() {
  document.querySelector("#error-text").innerText = "";
  originalLoaded = false;
  modifiedLoaded = false;

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

  originalReader.readAsArrayBuffer(
    document.querySelector("#original-file").files[0],
  );
  patchReader.readAsArrayBuffer(document.querySelector("#patch-file").files[0]);

  originalReader.onload = () => {
    originalLoaded = true;
    attemptApplyPatch();
  };

  patchReader.onload = () => {
    patchLoaded = true;
    attemptApplyPatch();
  };
}

function generatePatch() {
  document.querySelector("#error-text").innerText = "";
  const originalBuffer = new Uint8Array(originalReader.result);
  const modifiedBuffer = new Uint8Array(modifiedReader.result);

  // we store the size of file B in the last four bytes of the diff
  // and an md5 of the original file in the 16 bytes before that
  // I am aware that usually header information like this is stored at the start of the file
  // but on the other hand, who gives a fuck
  let patchBuffer = new Uint8Array(new ArrayBuffer(modifiedBuffer.length + 20));

  for (let i = 0; i < modifiedReader.result.byteLength; i++) {
    const originalByte = originalBuffer.length > i ? originalBuffer[i] : 0; // pad a with zeros if b is larger since the patch is always the size of b
    const modifiedByte = modifiedBuffer[i];
    patchBuffer[i] = originalByte ^ modifiedByte;
  }

  console.log(`Patched file size is ${modifiedBuffer.length}`);

  let checksum = SparkMD5.ArrayBuffer.hash(originalReader.result);
  console.log(`Original file checksum is ${checksum}`);

  let patchArray = Array.from(patchBuffer);
  patchArray.splice(
    patchBuffer.length - 20,
    16,
    ...Array.from(fromHexString(checksum)),
  );
  patchArray.splice(
    patchBuffer.length - 4,
    4,
    ...packBits(modifiedBuffer.length, 4),
  );
  patchBuffer = Uint8Array.from(patchArray);

  const blob = new Blob([patchBuffer], { type: "application/octet-stream" });
  saveFile(
    blob,
    document.querySelector("#modified-file").files[0].name + "_patch.bin",
  );
}

function applyPatch() {
  document.querySelector("#error-text").innerText = "";
  const originalBuffer = new Uint8Array(originalReader.result);
  const patchBuffer = new Uint8Array(patchReader.result);

  const patchArray = Array.from(patchBuffer);
  const patchSize = unpackBits(patchArray.slice(patchBuffer.length - 3));
  console.log(`Patched file size is ${patchSize} bytes`);

  if (patchSize == 0) {
    console.log("Patched file size cannot be zero");
    document.querySelector("#error-text").innerText =
      "Patched file size was zero! This usually indicates a corrupt or invalid patch file.";
    return;
  }

  const checksumFromPatch = toHexString(
    Uint8Array.from(
      patchArray.slice(patchArray.length - 20, patchArray.length - 4),
    ),
  );
  console.log(
    `Patch file expected original file checksum to be ${checksumFromPatch}`,
  );
  const checksumFromUpload = SparkMD5.ArrayBuffer.hash(originalReader.result);
  console.log(`Original file checksum is ${checksumFromUpload}`);

  if (checksumFromPatch != checksumFromUpload) {
    console.log("Checksums do not match!");
    document.querySelector("#error-text").innerHTML =
      `File checksums do not match! Make sure you have the correct original and patch files.<br>Original checksum: <code>${checksumFromUpload}</code><br>Patch file expected checksum: <code>${checksumFromPatch}</code>`;
    return;
  }

  console.log("Checksums match!");

  const modifiedBuffer = new Uint8Array(new ArrayBuffer(patchSize));

  for (let i = 0; i < patchSize; i++) {
    const originalByte = originalBuffer.length > i ? originalBuffer[i] : 0;
    const patchByte = patchBuffer[i];
    modifiedBuffer[i] = originalByte ^ patchByte;
  }

  const blob = new Blob([modifiedBuffer], { type: "application/octet-stream" });
  // remove anything from the filename after the last occurrence of "_patch"
  let filename = document.querySelector("#patch-file").files[0].name;
  saveFile(blob, filename.slice(0, filename.lastIndexOf("_patch")));
}

function setTab(t) {
  const applyTab = document.querySelector("#apply-tab");
  const genTab = document.querySelector("#gen-tab");
  const bcLabel = document.querySelector("#modified-patch-file-label");
  const goButton = document.querySelector("#go-button");
  const goButtonText = document.querySelector("#go-button-text");

  if (t == genTab) {
    genTab.classList.add("tab-active");
    applyTab.classList.remove("tab-active");
    bcLabel.innerText = "Modified File";
    goButton.onclick = tryGeneratePatch;
    goButtonText.innerText = "Generate Patch";
  } else {
    genTab.classList.remove("tab-active");
    applyTab.classList.add("tab-active");
    bcLabel.innerText = "Patch File";
    goButton.onclick = tryApplyPatch;
    goButtonText.innerText = "Patch";
  }
}
