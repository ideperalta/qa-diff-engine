const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright');
const fs = require('fs');
const PNG = require('pngjs').PNG;
const pixelmatch = require('pixelmatch');
const path = require('path');

const app = express();
// Allow requests from your CMS domain
app.use(cors({ origin: '*' })); 
app.use(express.json());

// Ensure public directory exists for storing images
const publicDir = path.join(__dirname, 'public');
if (!fs.existsSync(publicDir)) {
    fs.mkdirSync(publicDir);
}

// Serve the generated images securely
app.use('/results', express.static(publicDir));

app.post('/api/compare', async (req, res) => {
    const { urlA, urlB, viewportWidth = 1440 } = req.body;

    if (!urlA || !urlB) {
        return res.status(400).json({ error: 'Both urlA and urlB are required.' });
    }

    let browser;
    try {
        browser = await chromium.launch({
            args: ['--no-sandbox', '--disable-setuid-sandbox'] // Required for cloud environments
        });
        
        const context = await browser.newContext({
            viewport: { width: viewportWidth, height: 900 }
        });

        const pageA = await context.newPage();
        const pageB = await context.newPage();

        await Promise.all([
            pageA.goto(urlA, { waitUntil: 'networkidle', timeout: 30000 }),
            pageB.goto(urlB, { waitUntil: 'networkidle', timeout: 30000 })
        ]);

        const pathA = path.join(publicDir, 'baseline.png');
        const pathB = path.join(publicDir, 'challenger.png');
        const pathDiff = path.join(publicDir, 'diff.png');

        await pageA.screenshot({ path: pathA, fullPage: true });
        await pageB.screenshot({ path: pathB, fullPage: true });
        
        await browser.close();

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
        console.error(error);
        res.status(500).json({ error: error.message });
    }
});

// Bind to cloud provider's port, fallback to 3000 locally
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`QA Engine live on port ${PORT}`));