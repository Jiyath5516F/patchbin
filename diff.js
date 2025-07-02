// https://stackoverflow.com/a/48968694/12646131
function saveFile(blob, filename) {
  if (window.navigator.msSaveOrOpenBlob) {
    window.navigator.msSaveOrOpenBlob(blob, filename);
  } else {
    const a = document.createElement('a');
    document.body.appendChild(a);
    const url = window.URL.createObjectURL(blob);
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => {
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }, 0)
  }
}

// https://stackoverflow.com/a/50868276/12646131
const fromHexString = (hexString) =>
  Uint8Array.from(hexString.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));

const toHexString = (bytes) =>
  bytes.reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), '');


function packBits(num, size){
  let buffer = [];
  while(num != 0){
    buffer.push(num & 255);
    num = num >> 8;
  }
  // pad with zeros
  buffer = Array(size - buffer.length).fill(0).concat(buffer);
  return buffer;
}

function unpackBits(buffer){
  let num = 0;
  while(buffer.length > 0){
    num = num << 8 | buffer.pop();
  }

  return num;
}

const aReader = new FileReader();
const bReader = new FileReader();
const cReader = new FileReader();

let aLoaded = false;
let bLoaded = false;
let cLoaded = false;

function attemptDiff(){
  if (aLoaded && bLoaded){
    calcDiff();
  }
}

function attemptApplyDiff(){
  if(aLoaded && cLoaded){
    applyDiff();
  }
}

function tryDiff(){
  document.querySelector("#error-text").innerText = "";
  aLoaded = false;
  bLoaded = false;

  if(document.querySelector("#file-a").files[0] == null){
    document.querySelector("#error-text").innerText = "You have not uploaded the original file!";
    return;
  }
  if(document.querySelector("#file-b").files[0] == null){
    document.querySelector("#error-text").innerText = "You have not uploaded the modified file!";
    return;
  }

  aReader.readAsArrayBuffer(document.querySelector("#file-a").files[0]);
  bReader.readAsArrayBuffer(document.querySelector("#file-b").files[0]);

  aReader.onload = () => {
    aLoaded = true;
    attemptDiff();
  }

  bReader.onload = () => {
    bLoaded = true;
    attemptDiff();
  }
}

function tryApplyDiff(){
  document.querySelector("#error-text").innerText = "";
  aLoaded = false;
  bLoaded = false;

  if(document.querySelector("#file-a").files[0] == null){
    document.querySelector("#error-text").innerText = "You have not uploaded the original file!";
    return;
  }
  if(document.querySelector("#file-c").files[0] == null){
    document.querySelector("#error-text").innerText = "You have not uploaded the patch file!";
    return;
  }

  aReader.readAsArrayBuffer(document.querySelector("#file-a").files[0]);
  cReader.readAsArrayBuffer(document.querySelector("#file-c").files[0]);

  aReader.onload = () => {
    aLoaded = true;
    attemptApplyDiff();
  }

  cReader.onload = () => {
    cLoaded = true;
    attemptApplyDiff();
  }
}

function calcDiff(){
  const aBuffer = new Uint8Array(aReader.result);
  const bBuffer = new Uint8Array(bReader.result);

  // we store the size of file B in the last four bytes of the diff
  // and an md5 of the original file in the 16 bytes before that
  let cBuffer = new Uint8Array(new ArrayBuffer(bBuffer.length + 20));


  for (let i = 0; i < bReader.result.byteLength; i++){
    const aByte = aBuffer.length > i ? aBuffer[i] : 0; // pad a with zeros if b is larger
    const bByte = bBuffer[i];
    cBuffer[i] = aByte ^ bByte;
  }

  console.log(`Patched file size is ${bBuffer.length}`);

  let checksum = SparkMD5.ArrayBuffer.hash(aReader.result);
  console.log(`Original file checksum is ${checksum}`);

  let cBufferE = Array.from(cBuffer);
  cBufferE.splice(cBuffer.length - 20, 16, ...Array.from(fromHexString(checksum)));
  cBufferE.splice(cBuffer.length - 4, 4, ...packBits(bBuffer.length, 4));
  cBuffer = Uint8Array.from(cBufferE);

  const blob = new Blob([cBuffer], { type: 'application/octet-stream' });
  saveFile(blob, document.querySelector("#file-b").files[0].name + "_patch.bin");
}

function applyDiff(){
  const aBuffer = new Uint8Array(aReader.result);
  const cBuffer = new Uint8Array(cReader.result);

  const cBufferE = Array.from(cBuffer);
  const bSize = unpackBits(cBufferE.slice(cBuffer.length - 3));
  console.log(`Patched file size is ${bSize} bytes`);

  if(bSize == 0){
    console.log("Patched file size cannot be zero")
    document.querySelector("#error-text").innerText = "Patched file size was zero! This usually indicates a corrupt or invalid patch file.";
    return;
  }

  const patchChecksum = toHexString(Uint8Array.from(cBufferE.slice(cBufferE.length - 20, cBufferE.length - 4)));
  console.log(`Patch file checksum is ${patchChecksum}`);
  const originalChecksum = SparkMD5.ArrayBuffer.hash(aReader.result);
  console.log(`Original file checksum is ${originalChecksum}`);

  if(patchChecksum != originalChecksum){
    console.log("Checksums do not match!")
    document.querySelector("#error-text").innerHTML = `File checksums do not match! Make sure you have the correct original and patch files.<br>Original checksum: <code>${originalChecksum}</code><br>Patch file expected checksum: <code>${patchChecksum}</code>`;
    return;
  }

  console.log("Checksums match!");

  const bBuffer = new Uint8Array(new ArrayBuffer(bSize));

  for (let i = 0; i < bSize; i++){
    const aByte = aBuffer.length > i ? aBuffer[i] : 0;
    const cByte = cBuffer[i];
    bBuffer[i] = aByte ^ cByte;
  }

  const blob = new Blob([bBuffer], { type: 'application/octet-stream' });
  // remove anything from the filename after the last occurrence of "_patch"
  let filename = document.querySelector("#file-c").files[0].name;
  saveFile(blob, filename.slice(0, filename.lastIndexOf("_patch")));
}

function setTab(t){
  const applyTab = document.querySelector("#apply-tab");
  const genTab = document.querySelector("#gen-tab");
  const bcLabel = document.querySelector("#file-b-c-label");
  const goButton = document.querySelector("#go-button");
  const goButtonText = document.querySelector("#go-button-text");

  if(t == genTab){
    genTab.classList.add("tab-active");
    applyTab.classList.remove("tab-active");
    bcLabel.innerText = "Modified File";
    goButton.onclick = tryDiff;
    goButtonText.innerText = "Generate Patch";
  } else {
    genTab.classList.remove("tab-active");
    applyTab.classList.add("tab-active");
    bcLabel.innerText = "Patch File";
    goButton.onclick = tryApplyDiff;
    goButtonText.innerText = "Patch";
  }
}
