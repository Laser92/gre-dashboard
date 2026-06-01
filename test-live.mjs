import puppeteer from 'puppeteer';

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
    console.log("Launching puppeteer...");
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    
    // Capture console logs from the browser
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.error('PAGE ERROR:', err.message));
    
    console.log("Navigating to https://gre-dashboard.onrender.com");
    await page.goto('https://gre-dashboard.onrender.com');
    
    console.log("Waiting for app to load...");
    await sleep(4000);
    
    await page.screenshot({ path: 'test_screenshot.png' });
    
    await browser.close();
    process.exit(0);
})();
