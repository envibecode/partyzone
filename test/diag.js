'use strict';
const { chromium } = require('playwright');
const BASE = 'http://localhost:3100';

(async () => {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    args: ['--no-sandbox'],
  });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await ctx.newPage();
  await page.goto(BASE);
  await page.fill('#guest-name', 'Diag');
  await page.click('#form-guest button');
  await page.waitForSelector('#screen-home.active');
  await page.click('#btn-create');
  await page.waitForSelector('#screen-room.active');
  await page.waitForTimeout(800);

  const info = await page.evaluate(() => {
    const w = document.documentElement.clientWidth;
    const bad = [];
    document.querySelectorAll('*').forEach((el) => {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.right > w + 1 || r.left < -1)) {
        bad.push({
          tag: el.tagName,
          cls: el.className && el.className.toString().slice(0, 60),
          id: el.id,
          left: Math.round(r.left),
          right: Math.round(r.right),
        });
      }
    });
    return { w, scrollWidth: document.documentElement.scrollWidth, bad: bad.slice(0, 25) };
  });
  console.log(JSON.stringify(info, null, 2));
  await browser.close();
})();
