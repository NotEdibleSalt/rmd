const { JSDOM } = require('jsdom');
const dom = new JSDOM('<!DOCTYPE html><html><body><div id="mermaid-container"></div></body></html>', { pretendToBeVisual: true, resources: 'usable' });
global.document = dom.window.document;
global.window = dom.window;
global.navigator = dom.window.navigator;
global.Element = dom.window.Element;
global.Node = dom.window.Node;
global.DOMParser = dom.window.DOMParser;
global.XMLSerializer = dom.window.XMLSerializer;
global.SVGElement = dom.window.SVGElement;
global.HTMLElement = dom.window.HTMLElement;
(async () => {
  const mermaid = (await import('mermaid')).default;
  
  // Test with default settings (useHtmlLabels: true)
  mermaid.initialize({ startOnLoad: false, theme: 'base', themeVariables: { primaryColor: '#4f6ef7', nodeTextColor: '#1a1a2e', background: '#ffffff' } });
  const r1 = await mermaid.render('test1', 'graph TD\n  A[开始] --> B[结束]');
  console.log('=== DEFAULT (useHtmlLabels=true) ===');
  console.log('Has foreignObject:', r1.svg.includes('foreignObject'));
  console.log('Has <text> element:', r1.svg.includes('<text'));
  console.log('SVG length:', r1.svg.length, 'bytes');
  console.log('First 300 chars:', r1.svg.substring(0, 300));
  
  // Test with useHtmlLabels: false
  mermaid.initialize({ startOnLoad: false, useHtmlLabels: false, theme: 'base', themeVariables: { primaryColor: '#4f6ef7', nodeTextColor: '#1a1a2e', background: '#ffffff' } });
  const r2 = await mermaid.render('test2', 'graph TD\n  A[开始] --> B[结束]');
  console.log('');
  console.log('=== useHtmlLabels=false ===');
  console.log('Has foreignObject:', r2.svg.includes('foreignObject'));
  console.log('Has <text> element:', r2.svg.includes('<text'));
  console.log('SVG length:', r2.svg.length, 'bytes');
  console.log('First 300 chars:', r2.svg.substring(0, 300));
})().catch(e => console.error(e.message));
