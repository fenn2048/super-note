
import { test, expect } from '@playwright/test';

test('verify task creation UI enhancement', async ({ page }) => {
  // Go to the app
  await page.goto('http://localhost:5173');

  // Wait for the page to load
  await page.waitForLoadState('networkidle');

  // Close "What's New" dialog if it exists
  const gotItButton = page.getByRole('button', { name: 'Got it' });
  if (await gotItButton.isVisible()) {
    await gotItButton.click();
  }

  // Click on "Tasks" in the sidebar
  // It might be a link or a button. Based on the screenshot, it's in the sidebar.
  // Let's try to find it by text.
  const tasksLink = page.getByRole('link', { name: /Tasks|任务/i }).or(page.getByText(/Tasks|任务/i));
  await tasksLink.first().click();

  // Wait for Task Center to load
  await page.waitForSelector('input[placeholder*="Task" i], input[placeholder*="任务" i]');

  // Verify UI Layout
  // Area 2 (Project Selector) should be before Area 1 (Checkbox + Input)
  // In my implementation:
  // <div className="flex items-center gap-2 mb-2"> { /* Area 2: Project Selector */ }
  // <div className="flex items-center gap-2"> { /* Area 1: Checkbox + Input */ }

  // Check for the project selector (Select element)
  const projectSelector = page.locator('select');
  await expect(projectSelector).toBeVisible();

  // Check for the checkbox
  const checkbox = page.getByRole('checkbox');
  await expect(checkbox).toBeVisible();
  await expect(checkbox).toBeChecked(); // Should be checked by default

  // Verify "Personal TODO" is selected in the selector
  // Note: If translations are working, it should be "个人TODO" or "Personal TODO"
  // Let's check the value or text
  await expect(projectSelector).toHaveValue('personal');

  // Capture screenshot of the new UI
  await page.screenshot({ path: 'verification/screenshots/task_center_ui.png' });

  // Test Linkage 1: Select a project -> Checkbox should uncheck
  // We need at least one workspace to test this.
  // If the list is empty, we can't test it easily without mocking.
  // Assuming there's a "Work" workspace from previous logic or if we can find another option.
  const options = await projectSelector.locator('option').all();
  if (options.length > 1) {
    // Select the second option (first workspace)
    const val = await options[1].getAttribute('value');
    if (val && val !== 'personal') {
      await projectSelector.selectOption(val);
      await expect(checkbox).not.toBeChecked();
    }
  }

  // Test Linkage 2: Uncheck checkbox -> Selector should change to first workspace
  await checkbox.check(); // Reset to checked
  await expect(projectSelector).toHaveValue('personal');

  await checkbox.uncheck();
  if (options.length > 1) {
    const firstWorkspaceVal = await options[1].getAttribute('value');
    await expect(projectSelector).toHaveValue(firstWorkspaceVal!);
  } else {
    // If no workspaces, it should show empty/warning state
    // In my code: setWorkspaceId('')
    await expect(projectSelector).toHaveValue('');
    // Check for warning message
    // await expect(page.getByText(/所选项目为空/)).toBeVisible();
  }

  await page.screenshot({ path: 'verification/screenshots/task_center_linkage.png' });
});
