# 签名格式转换器

一个纯前端签名导出网页，可以通过打字或手写生成签名，并导出为 PNG、JPEG 或 SVG。

## 使用

公网地址：

```text
https://bug-jump.github.io/signature-converter/
```

本地预览也可以直接在浏览器打开 `index.html`。

## 功能

- 自定义导出宽度和高度
- 打字生成签名
- 鼠标或触屏手写签名，支持书写和擦除
- 调整笔宽、笔色和背景颜色
- 导出 PNG、JPEG、SVG

## 更新并发布

项目已经绑定到 GitHub Pages。以后修改本文件夹里的代码后，执行：

```bash
git status
git add index.html styles.css app.js README.md
git commit -m "Update signature converter"
git push
```

推送完成后，GitHub Pages 会自动更新：

```text
https://bug-jump.github.io/signature-converter/
```

GitHub Pages 可能有几分钟缓存。如果手机打开还是旧版本，可以给网址加一个版本参数，例如：

```text
https://bug-jump.github.io/signature-converter/?v=2
```
