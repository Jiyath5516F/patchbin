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
  aLoaded = false;
  bLoaded = false;
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
  aLoaded = false;
  bLoaded = false;
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
  const maxLength = Math.max(aReader.result.byteLength, bReader.result.byteLength);

  const aBuffer = new Uint8Array(aReader.result);
  const bBuffer = new Uint8Array(bReader.result);

  // we store the size of file B in the last four bytes of the diff
  const cBuffer = new Uint8Array(new ArrayBuffer(maxLength + 4));

  for (let i = 0; i < maxLength; i++){
    const aByte = i < aBuffer.length ? aBuffer[i] : 0;
    const bByte = i < bBuffer.length ? bBuffer[i] : 0;
    cBuffer[i] = aByte ^ bByte;
  }


  cBuffer[cBuffer.length-1] = bReader.result.byteLength & 255;
  cBuffer[cBuffer.length-2] = (bReader.result.byteLength >> 8) & 255;
  cBuffer[cBuffer.length-3] = (bReader.result.byteLength >> 16) & 255;
  cBuffer[cBuffer.length-4] = (bReader.result.byteLength >> 24) & 255;

  const blob = new Blob([cBuffer], { type: 'application/octet-stream' });
  window.open(URL.createObjectURL(blob), '_blank').focus();
}

function applyDiff(){
  const aBuffer = new Uint8Array(aReader.result);
  const cBuffer = new Uint8Array(cReader.result);

  const bSize = cBuffer[cBuffer.length-1] | (cBuffer[cBuffer.length-2] << 8) | (cBuffer[cBuffer.length-3] << 16) | (cBuffer[cBuffer.length-4] << 24);
  console.log(bSize);

  const bBuffer = new Uint8Array(new ArrayBuffer(bSize));

  for (let i = 0; i < bSize; i++){
    const aByte = i < aBuffer.length ? aBuffer[i] : 0;
    const cByte = i < cBuffer.length ? cBuffer[i] : 0;
    bBuffer[i] = aByte ^ cByte;
  }

  const blob = new Blob([bBuffer], { type: 'application/octet-stream' });
  window.open(URL.createObjectURL(blob), '_blank').focus();
}
