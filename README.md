# Mistral OCR - Bob 文本识别插件

基于 [Mistral AI OCR](https://docs.mistral.ai/capabilities/document/) 的 [Bob](https://bobtranslate.com/) 文本识别（OCR）插件。

## 功能

- 调用 Mistral OCR API 识别图片中的文字
- 支持多语言识别（中文、英文、日文、韩文等 18 种语言）
- 支持表格、公式等复杂排版识别
- 可选保留 Markdown 格式或输出纯文本
- 支持自定义 API 地址（代理/中转）

## 安装

1. 前往 [Releases](https://github.com/poyih/bob-plugin-Mistral-ocr/releases) 下载最新的 `Mistral-OCR.bobplugin` 文件
2. 双击安装到 Bob

## 配置

1. 前往 [Mistral AI Console](https://console.mistral.ai/api-keys) 获取 API Key
2. 在 Bob 偏好设置 → 插件 → Mistral OCR 中填入 API Key

| 选项 | 说明 |
|------|------|
| API Key | Mistral AI API Key（必填） |
| 自定义 API 地址 | 可留空，默认为 `https://api.mistral.ai` |
| 保留 Markdown 格式 | 默认去除格式符号输出纯文本，可选保留原始 Markdown |

## 支持语言

中文简体、中文繁体、英语、日语、韩语、法语、德语、西班牙语、意大利语、葡萄牙语、俄语、阿拉伯语、荷兰语、波兰语、泰语、越南语、土耳其语

## 感谢

- [Bob](https://bobtranslate.com/) - macOS 翻译和 OCR 软件
- [Mistral AI](https://mistral.ai/) - OCR 能力提供方
