async (page) => {
  await page.goto('about:blank');
  await page.setContent(`
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
<div id="out1"></div>
<div id="out2"></div>
<script type="module">
import mermaid from '/C:/softtware/code/rust/rmd/node_modules/mermaid/dist/mermaid.esm.mjs';

mermaid.initialize({ startOnLoad: false, theme: 'base', themeVariables: { primaryColor: '#4f6ef7', nodeTextColor: '#1a1a2e', background: '#ffffff' } });
const r1 = await mermaid.render('test1', 'graph TD\\n  A[开始] --> B[结束]');
document.getElementById('out1').textContent = JSON.stringify({
  hasForeignObject: r1.svg.includes('foreignObject'),
  hasTextElement: r1.svg.includes('<text'),
  length: r1.svg.length,
  preview: r1.svg.substring(0, 400)
});

mermaid.initialize({ startOnLoad: false, useHtmlLabels: false, theme: 'base', themeVariables: { primaryColor: '#4f6ef7', nodeTextColor: '#1a1a2e', background: '#ffffff' } });
const r2 = await mermaid.render('test2', 'graph TD\\n  A[开始] --> B[结束]');
document.getElementById('out2').textContent = JSON.stringify({
  hasForeignObject: r2.svg.includes('foreignObject'),
  hasTextElement: r2.svg.includes('<text'),
  length: r2.svg.length,
  preview: r2.svg.substring(0, 400)
});

document.title = 'DONE';
</script>
</body>
</html>
`);
  await page.waitForFunction(() => document.title === 'DONE', { timeout: 20000 });
  const out1 = await page.evaluate(() => document.getElementById('out1').textContent);
  const out2 = await page.evaluate(() => document.getElementById('out2').textContent);
  return 'TEST1=' + out1 + '\\nTEST2=' + out2;
}
