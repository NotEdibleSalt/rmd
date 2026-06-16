# Changelog

## [Unreleased]

### Features

### Improvements

### Bug Fixes

---

## [0.2.0] - 2026-06-16

### Features

- PDF 导出重写：基于 Edge 浏览器渲染引擎生成，支持 Mermaid 图表渲染和 CSS 控制打印布局
- DOCX 导出重写：支持嵌入式图片（自动将 SVG 转换为 PNG），支持 WikiLink 解析
- HTML、DOCX、PDF 三种导出格式的标题增加自动编号

### Improvements

- 图片编辑优化：支持行内图片拖拽缩放，点击即可选中图片

### Bug Fixes

- 修复若干样式问题
- 修复 PDF 导出中 Mermaid 图表尺寸异常（较大图表超出页边距）的问题
