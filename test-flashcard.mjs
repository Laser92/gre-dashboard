import puppeteer from 'puppeteer';
import { spawn } from 'child_process';
import http from 'http';

async function checkServer() {
    return new Promise((resolve) => {
        const req = http.get('http://localhost:3000', (res) => {
            resolve(res.statusCode === 200);
        });
        req.on('error', () => resolve(false));
    });
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

(async () => {
    console.log("Starting server...");
    const server = spawn('node', ['server.js'], { env: { ...process.env, PORT: '3000' } });
    
    server.stdout.on('data', data => console.log('SERVER:', data.toString().trim()));
    server.stderr.on('data', data => console.error('SERVER ERR:', data.toString().trim()));

    for (let i = 0; i < 20; i++) {
        if (await checkServer()) break;
        await sleep(500);
    }
    
    console.log("Server is up. Launching puppeteer...");
    const browser = await puppeteer.launch({ headless: 'new' });
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    
    console.log("Navigating to http://localhost:3000");
    await page.goto('http://localhost:3000');
    
    console.log("Waiting for app to load...");
    await sleep(2000);
    
    console.log("Logging in...");
    await page.type('#login-username', 'testuser');
    await page.click('button[onclick="login()"]');
    
    await sleep(2000);
    
    console.log("Clicking flashcards button...");
    await page.click('#nav-flashcards');
    
    await sleep(1000);
    
    const fcWordText = await page.$eval('#fc-word', el => el.textContent);
    const fcWordHtml = await page.$eval('#fc-word', el => el.outerHTML);
    const fcPosHtml = await page.$eval('#fc-pos', el => el.outerHTML);
    const fcWordDisplay = await page.$eval('#fc-word', el => window.getComputedStyle(el).display);
    
    console.log("RESULTS:");
    console.log("fc-word textContent:", fcWordText);
    console.log("fc-word HTML:", fcWordHtml);
    console.log("fc-pos HTML:", fcPosHtml);
    console.log("fc-word CSS display:", fcWordDisplay);
    
    await page.screenshot({ path: 'test_screenshot.png' });
    
    await browser.close();
    server.kill();
    process.exit(0);
})();
