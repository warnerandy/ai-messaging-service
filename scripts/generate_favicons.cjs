const fs = require('fs');
const path = require('path');
const { chromium } = require('@playwright/test');

function createIco(images) {
  // images: array of { width, height, buffer }
  const count = images.length;
  const headerSize = 6;
  const dirEntrySize = 16;
  const totalHeaderSize = headerSize + count * dirEntrySize;
  
  let currentOffset = totalHeaderSize;
  const entries = [];
  
  for (const img of images) {
    const entry = Buffer.alloc(dirEntrySize);
    entry.writeUInt8(img.width >= 256 ? 0 : img.width, 0); // bWidth
    entry.writeUInt8(img.height >= 256 ? 0 : img.height, 1); // bHeight
    entry.writeUInt8(0, 2); // bColorCount
    entry.writeUInt8(0, 3); // bReserved
    entry.writeUInt16LE(1, 4); // wPlanes
    entry.writeUInt16LE(32, 6); // wBitCount
    entry.writeUInt32LE(img.buffer.length, 8); // dwBytesInRes
    entry.writeUInt32LE(currentOffset, 12); // dwImageOffset
    
    entries.push(entry);
    currentOffset += img.buffer.length;
  }
  
  const iconDir = Buffer.alloc(headerSize);
  iconDir.writeUInt16LE(0, 0); // idReserved
  iconDir.writeUInt16LE(1, 2); // idType (1 = icon)
  iconDir.writeUInt16LE(count, 4); // idCount
  
  return Buffer.concat([
    iconDir,
    ...entries,
    ...images.map(img => img.buffer)
  ]);
}

async function main() {
  const sourcePath = path.join(__dirname, '../priv/static/botamus-prime-512.png');
  if (!fs.existsSync(sourcePath)) {
    console.error('Source icon does not exist:', sourcePath);
    process.exit(1);
  }
  
  const srcBase64 = fs.readFileSync(sourcePath).toString('base64');
  const chromePath = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
    ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
    : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';
  console.log('Launching browser at ' + chromePath + ' to render icons...');
  const browser = await chromium.launch({ executablePath: chromePath });
  const page = await browser.newPage();
  
  await page.setContent(`
    <!DOCTYPE html>
    <html>
      <body style="margin:0;padding:0;background:transparent;">
        <img id="src" src="data:image/png;base64,${srcBase64}" />
      </body>
    </html>
  `);
  
  const sizes = [16, 32, 48, 180];
  const rendered = {};
  
  for (const size of sizes) {
    const dataUrl = await page.evaluate((s) => {
      const img = document.getElementById('src');
      const canvas = document.createElement('canvas');
      canvas.width = s;
      canvas.height = s;
      const ctx = canvas.getContext('2d');
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, 0, 0, s, s);
      return canvas.toDataURL('image/png');
    }, size);
    
    const base64Data = dataUrl.replace(/^data:image\/png;base64,/, '');
    rendered[size] = Buffer.from(base64Data, 'base64');
  }
  
  await browser.close();
  
  const staticDir = path.join(__dirname, '../priv/static');
  
  // 1. Write individual PNGs
  fs.writeFileSync(path.join(staticDir, 'favicon-16x16.png'), rendered[16]);
  console.log('Wrote favicon-16x16.png (' + rendered[16].length + ' bytes)');
  
  fs.writeFileSync(path.join(staticDir, 'favicon-32x32.png'), rendered[32]);
  console.log('Wrote favicon-32x32.png (' + rendered[32].length + ' bytes)');
  
  fs.writeFileSync(path.join(staticDir, 'favicon-48x48.png'), rendered[48]);
  console.log('Wrote favicon-48x48.png (' + rendered[48].length + ' bytes)');
  
  fs.writeFileSync(path.join(staticDir, 'apple-touch-icon.png'), rendered[180]);
  console.log('Wrote apple-touch-icon.png (' + rendered[180].length + ' bytes)');
  
  // 2. Build multi-resolution favicon.ico
  const icoBuffer = createIco([
    { width: 16, height: 16, buffer: rendered[16] },
    { width: 32, height: 32, buffer: rendered[32] },
    { width: 48, height: 48, buffer: rendered[48] }
  ]);
  fs.writeFileSync(path.join(staticDir, 'favicon.ico'), icoBuffer);
  console.log('Wrote multi-res favicon.ico (' + icoBuffer.length + ' bytes)');
  
  // 3. Generate favicon.svg
  const svgContent = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="100%" height="100%">
  <defs>
    <clipPath id="circle-clip">
      <circle cx="256" cy="256" r="256" />
    </clipPath>
  </defs>
  <image href="data:image/png;base64,${srcBase64}" x="0" y="0" width="512" height="512" />
</svg>
`;
  fs.writeFileSync(path.join(staticDir, 'favicon.svg'), svgContent, 'utf8');
  console.log('Wrote favicon.svg (' + svgContent.length + ' bytes)');
  
  // 4. Update index.html
  const indexPath = path.join(staticDir, 'index.html');
  if (fs.existsSync(indexPath)) {
    let indexHtml = fs.readFileSync(indexPath, 'utf8');
    const oldIconSection = /<link rel="icon" href="\/favicon\.ico" \/>[\s\S]*?<link rel="apple-touch-icon" href="\/botamus-prime-192\.png" \/>/;
    const newIconSection = `<link rel="icon" href="/favicon.ico" sizes="any" />
    <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
    <link rel="icon" href="/favicon-32x32.png" type="image/png" sizes="32x32" />
    <link rel="icon" href="/favicon-16x16.png" type="image/png" sizes="16x16" />
    <link rel="icon" href="/botamus-prime-192.png" type="image/png" sizes="192x192" />
    <link rel="apple-touch-icon" href="/apple-touch-icon.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png" />`;
    
    if (oldIconSection.test(indexHtml)) {
      indexHtml = indexHtml.replace(oldIconSection, newIconSection);
      fs.writeFileSync(indexPath, indexHtml, 'utf8');
      console.log('Updated index.html icon link tags!');
    }
  }

  // 5. Update manifest.webmanifest
  const manifestPath = path.join(staticDir, 'manifest.webmanifest');
  if (fs.existsSync(manifestPath)) {
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.icons = [
      {
        src: "/favicon.ico",
        sizes: "48x48 32x32 16x16",
        type: "image/x-icon"
      },
      {
        src: "/favicon-32x32.png",
        sizes: "32x32",
        type: "image/png"
      },
      {
        src: "/favicon-16x16.png",
        sizes: "16x16",
        type: "image/png"
      },
      {
        src: "/apple-touch-icon.png",
        sizes: "180x180",
        type: "image/png"
      },
      {
        src: "/botamus-prime-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any"
      },
      {
        src: "/botamus-prime-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable"
      }
    ];
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
    console.log('Updated manifest.webmanifest icon entries!');
  }

  console.log('Favicon generation complete!');
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
