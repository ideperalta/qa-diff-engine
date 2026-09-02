const express = require('express');
const cors = require('cors');
const { chromium } = require('playwright-extra'); 
const stealth = require('puppeteer-extra-plugin-stealth')();
chromium.use(stealth);
const fs = require('fs');
const path = require('path');
const OpenAI = require('openai');

const app = express();
app.use(cors({ origin: '*' })); 
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
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
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
        
        const context = await browser.newContext({
            viewport: { width: viewportWidth, height: 900 },
            userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        });

        const pathA = path.join(publicDir, 'baseline.png');
        const pathB = path.join(publicDir, 'challenger.png');

        // 1. Capture Baseline
        const pageA = await context.newPage();
        await pageA.goto(urlA, { waitUntil: 'load', timeout: 60000 });
        await pageA.waitForTimeout(2000);
        await pageA.screenshot({ path: pathA, fullPage: false }); // Viewport fold comparison for memory efficiency
        await pageA.close();

        // 2. Capture Challenger
        const pageB = await context.newPage();
        await pageB.goto(urlB, { waitUntil: 'load', timeout: 60000 });
        await pageB.waitForTimeout(2000);
        await pageB.screenshot({ path: pathB, fullPage: false });
        await pageB.close();
        
        await browser.close();

        // 3. Encode images to Base64 for AI Vision analysis
        const base64ImageA = fs.readFileSync(pathA).toString('base64');
        const base64ImageB = fs.readFileSync(pathB).toString('base64');

        // 4. Request Visual AI Comparison
        const response = await openai.chat.completions.create({
            model: "gpt-4o",
            response_format: { type: "json_object" },
            messages: [
                {
                    role: "system",
                    content: `You are an expert QA and UX Automation Engineer. Compare Image 1 (Baseline Design) against Image 2 (Challenger Design). 
                    Analyze structural, layout, style, and content differences. Return a JSON object with:
                    {
                      "differencePercentage": number (0-100),
                      "summary": "High-level summary of the comparison",
                      "missingFromBaseline": ["List of elements present in Image 1 but missing in Image 2"],
                      "addedInChallenger": ["List of new elements present in Image 2 but absent in Image 1"],
                      "designDiscrepancies": ["Specific style, font, color, or layout alignment shifts"]
                    }`
                },
                {
                    role: "user",
                    content: [
                        { type: "text", text: "Compare Baseline (Image 1) and Challenger (Image 2):" },
                        { type: "image_url", image_url: { url: `data:image/png;base64,${base64ImageA}` } },
                        { type: "image_url", image_url: { url: `data:image/png;base64,${base64ImageB}` } }
                    ]
                }
            ]
        });

        const analysis = JSON.parse(response.choices[0].message.content);

        res.json({
            success: true,
            analysis,
            images: {
                baseline: '/results/baseline.png',
                challenger: '/results/challenger.png'
            }
        });

    } catch (error) {
        if (browser) await browser.close();
        console.error('SERVER ERROR:', error);
        res.status(500).json({ error: error.message });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Design Intelligence Engine live on port ${PORT}`));
