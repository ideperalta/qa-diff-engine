const express = require('express');
const cors = require('cors');
// === STEALTH PLUGINS ADDED HERE ===
const { chromium } = require('playwright-extra'); 
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
// ==================================
const fs = require('fs');
const PNG = require('pngjs').PNG;
const pixelmatch = require('pixelmatch');
const path = require('path');

const app = express();
app.use(cors({ origin: '*' })); 
app.use(express.json());

const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir);
}

app.use('/results', express.static(publicDir));

app.post('/api/compare', async (req, res) => {
    const { urlA, urlB, viewportWidth = 1440 } = req.body;

    if (!urlA || !urlB) {
        return res.status(400).json({ error: 'Both urlA and urlB are required.' });
    }

    let browser;
    try {
        browser = await chromium.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });
        
        const context = await browser.newContext({
            viewport: { width: viewportWidth, height: 900 },
            // === SPOOFING A REAL GOOGLE CHROME BROWSER ===
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });

        const pageA = await context.newPage();
        const pageB = await context.newPage();

        console.log(`Navigating to ${urlA} and ${urlB}...`);

        await Promise.all([
            pageA.goto(urlA, { waitUntil: 'load', timeout: 60000 }),
            pageB.goto(urlB, { waitUntil: 'load', timeout: 60000 })
        ]);

        await pageA.waitForTimeout(2000);
        await pageB.waitForTimeout(2000);

        const pathA = path.join(publicDir, 'baseline.png');
        const pathB = path.join(publicDir, 'challenger.png');
        const pathDiff = path.join(publicDir, 'diff.png');

        console.log('Capturing screenshots...');
        await pageA.screenshot({ path: pathA, fullPage: true });
        await pageB.screenshot({ path: pathB, fullPage: true });
        
        await browser.close();

        console.log('Comparing pixels...');
        const img1 = PNG.sync.read(fs.readFileSync(pathA));
        const img2 = PNG.sync.read(fs.readFileSync(pathB));
        
        const { width, height } = img1;
        const diff = new PNG({ width, height });

        const mismatchedPixels = pixelmatch(
            img1.data, 
            img2.data, 
            diff.data, 
            width, 
            height, 
            { threshold: 0.1, diffColor: [255, 0, 0] }
        );

        fs.writeFileSync(pathDiff, PNG.sync.write(diff));

        console.log('Analysis complete. Sending to frontend.');
        res.json({
            mismatchedPixels,
            match: mismatchedPixels === 0,
            images: {
                baseline: '/results/baseline.png',
                challenger: '/results/challenger.png',
                diff: '/results/diff.png'
            }
        });

    } catch (error) {
        if (browser) await browser.close();
        console.error('SERVER ERROR:', error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`QA Engine live on port ${PORT}`));
