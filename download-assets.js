const fs = require('fs');
const path = require('path');
const https = require('https');

const ASSETS_DIR = path.join(__dirname, 'assets');

const IMAGES = {
  'neemans_shoes.jpg': 'https://m.media-amazon.com/images/I/71wE7xR1YDL._SL1500_.jpg',
  'beco_garbage.jpg': 'https://m.media-amazon.com/images/I/71YtS7h7-VL._SL1500_.jpg',
  'milton_bottle.jpg': 'https://m.media-amazon.com/images/I/611ZzB6J5dL._SL1500_.jpg',
  'beco_dishwash.jpg': 'https://m.media-amazon.com/images/I/61Nl5zQ1p4L._SL1500_.jpg',
  'no_nasties_shirt.jpg': 'https://m.media-amazon.com/images/I/71cUX6n2mKL._SL1500_.jpg',
  'renewed_iphone.jpg': 'https://m.media-amazon.com/images/I/61-r9z7URFL._SL1500_.jpg',
  'renewed_macbook.jpg': 'https://m.media-amazon.com/images/I/71vFKBpKakL._SL1500_.jpg'
};

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    };
    https.get(options, (response) => {
      if (response.statusCode !== 200) {
        reject(new Error(`Failed to get '${url}' (Status Code: ${response.statusCode})`));
        return;
      }
      response.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve();
      });
    }).on('error', (err) => {
      fs.unlink(dest, () => {});
      reject(err);
    });
  });
}

async function main() {
  if (!fs.existsSync(ASSETS_DIR)) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
  }

  console.log('Downloading local assets with User-Agent...');
  for (const [filename, url] of Object.entries(IMAGES)) {
    const dest = path.join(ASSETS_DIR, filename);
    try {
      await download(url, dest);
      console.log(`✓ Downloaded ${filename}`);
    } catch (err) {
      console.error(`✗ Failed to download ${filename}:`, err.message);
    }
  }
  console.log('Done!');
}

main();
