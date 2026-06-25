# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: tests/verification/verify_nav_changes.spec.ts >> verify navigation rail and sidebar changes
- Location: tests/verification/verify_nav_changes.spec.ts:3:1

# Error details

```
Test timeout of 30000ms exceeded.
```

```
Error: locator.click: Test timeout of 30000ms exceeded.
Call log:
  - waiting for locator('.vibrancy-sidebar').first().getByText(/项目管理|Projects/i).first()

```

# Page snapshot

```yaml
- generic [ref=e1]:
  - generic [ref=e5]:
    - generic [ref=e6]:
      - img [ref=e8]
      - heading "ark-note" [level=1] [ref=e10]
      - paragraph [ref=e11]: Private Knowledge Base · Welcome Back
    - generic [ref=e12]:
      - button "Sign In" [ref=e13] [cursor=pointer]
      - button "Sign Up" [ref=e14] [cursor=pointer]
    - generic [ref=e15]:
      - generic [ref=e16]:
        - text: Username
        - generic [ref=e17]:
          - generic:
            - img
          - textbox "Enter username" [active] [ref=e18]
      - generic [ref=e19]:
        - text: Password
        - generic [ref=e20]:
          - generic:
            - img
          - textbox "••••••••" [ref=e21]
          - button "显示密码" [ref=e22] [cursor=pointer]:
            - img [ref=e23]
      - button "Sign In" [disabled] [ref=e26]
  - status
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  |
  3  | test('verify navigation rail and sidebar changes', async ({ page }) => {
  4  |   await page.goto('http://localhost:5173');
  5  |   await page.waitForLoadState('networkidle');
  6  |
  7  |   // Debug: print all button texts in rail
  8  |   const rail = page.locator('.vibrancy-sidebar').first();
  9  |   const buttons = await rail.locator('button').allInnerTexts();
  10 |   console.log('Rail buttons:', buttons);
  11 |
  12 |   // 1. Verify "Plan Management" (计划管理) is NOT in the NavRail
  13 |   await expect(rail.getByText(/计划管理|Plan Management/i)).not.toBeVisible();
  14 |
  15 |   // 2. Click on "Project Management" (项目管理) - looking for the text directly if possible
  16 |   const projectsLink = rail.getByText(/项目管理|Projects/i);
> 17 |   await projectsLink.first().click();
     |                              ^ Error: locator.click: Test timeout of 30000ms exceeded.
  18 |
  19 |   // 3. Verify "My Plans" (我的计划) IS in the project sidebar
  20 |   await expect(page.getByText(/我的计划|My Plans/i)).toBeVisible();
  21 |
  22 |   // 4. Click "My Plans" and verify Project icon in Rail stays active
  23 |   await page.getByText(/我的计划|My Plans/i).click();
  24 |
  25 |   // Verify projects icon is active
  26 |   await expect(rail.locator('button').filter({ has: page.getByText(/项目管理|Projects/i) }).first()).toHaveClass(/bg-accent-primary/);
  27 |
  28 |   await page.screenshot({ path: 'verification/screenshots/nav_changes_verified.png' });
  29 | });
  30 |
```