import { chromium } from '@playwright/test';

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();

  const consoleLogs = [];
  page.on('console', msg => {
    const t = msg.text();
    consoleLogs.push(t);
    if (t.includes('FoliateView') || t.includes('BookReader')) {
      console.log(`[BROWSER] ${msg.type()}: ${t}`);
    }
  });

  await page.goto('http://localhost:5173/#/login');
  await page.waitForSelector('input[placeholder*="username"]', { timeout: 5000 });
  await page.fill('input[placeholder*="username"]', 'admin');
  await page.fill('input[type="password"]', 'admin123');
  await page.click('button[type="submit"]');
  await page.waitForTimeout(5000);

  // Start fresh: navigate to the book page directly 
  await page.goto('http://localhost:5173/#/books/7d327d34c238f4899d7ad6de9c15eb65b501e3771e08f32619c6e9415d01e420');
  console.log("Waiting 12 seconds for book to fully load...");
  await page.waitForTimeout(12000);

  // Check what sections are loaded, their element IDs, and how many SVG annotations are drawn
  const info = await page.evaluate(() => {
    const view = document.querySelector('foliate-view');
    if (!view) return { error: "no foliate-view" };
    const sr = view.shadowRoot;
    const paginator = sr.querySelector('foliate-paginator');
    const pSR = paginator.shadowRoot;
    const container = pSR.querySelector('#container');

    const results = [];
    for (let i = 0; i < container.children.length; i++) {
      const el = container.children[i];
      const svg = el.querySelector('svg');
      const iframe = el.querySelector('iframe');
      const svgGroups = [];
      if (svg) {
        svg.querySelectorAll('g').forEach(g => svgGroups.push({
          fill: g.getAttribute('fill'),
          stroke: g.getAttribute('stroke'),
          rectCount: g.querySelectorAll('rect, path, line').length
        }));
      }
      let bodyText = '', elementIds = [], hasTargetId = false;
      try {
        const doc = iframe.contentDocument;
        if (doc && doc.body) {
          bodyText = doc.body.innerText.substring(0, 200);
          const all = doc.querySelectorAll('[id]');
          all.forEach(el => elementIds.push(el.id));
          hasTargetId = !!doc.getElementById('8IL20-a4083b636e2340b686986467c813c7cf');
        }
      } catch(e) {}

      results.push({
        viewIndex: i,
        containerWidth: el.style.width,
        svgGroupsCount: svgGroups.length,
        svgGroups: svgGroups,
        bodyTextStart: bodyText,
        hasTargetId,
        first5ElementIds: elementIds.slice(0, 5)
      });
    }

    const contents = paginator.getContents();
    return {
      views: results,
      contents: contents.map(c => ({ index: c.index, hasOverlayer: !!c.overlayer }))
    };
  });

  console.log("\n=== INITIAL BOOK STATE ===");
  console.log(JSON.stringify(info, null, 2));

  // Count fallback logs
  const fallbackLogs = consoleLogs.filter(l => l.includes('fallback found'));
  console.log("\n=== FALLBACK HITS ===");
  console.log(fallbackLogs.length, "fallback(s) found:", fallbackLogs);

  await page.screenshot({ path: '/Users/westone/.gemini/antigravity-cli/brain/8f68d9c6-b786-4c8e-ac41-a8f9a16f92ae/screenshot.png' });
  console.log("Screenshot saved.");
  await browser.close();
})();
