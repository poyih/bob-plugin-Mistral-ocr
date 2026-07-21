# Mistral OCR - Bob 文本识别插件

基于 [Mistral AI OCR](https://docs.mistral.ai/capabilities/document/) 的 [Bob](https://bobtranslate.com/) 文本识别（OCR）插件。

## 功能

- 调用 Mistral OCR API 识别图片中的文字
- 可选择 OCR 模型版本：最新版、OCR 4（26.06）、OCR 3（25.12）、OCR 2（25.05）、OCR（25.03）
- 支持多语言识别（中文简繁、粤语、文言文、英、日、韩、葡（葡/巴）等 30+ 种语言）
- 支持表格、公式等复杂排版识别
- 可选保留 Markdown 格式或输出纯文本
- 支持自定义 API 地址（代理/中转）
- 内置 API Key 验证按钮，验证失败时直达控制台排障链接

## 安装

1. 前往 [Releases](https://github.com/poyih/bob-plugin-mistral-ocr/releases) 下载最新的 `Mistral-OCR.bobplugin` 文件
2. 双击安装到 Bob

## 配置

1. 前往 [Mistral AI Console](https://console.mistral.ai/api-keys) 获取 API Key
2. 在 Bob 偏好设置 → 插件 → Mistral OCR 中填入 API Key

| 选项 | 说明 |
|------|------|
| API Key | Mistral AI API Key（必填） |
| 自定义 API 地址 | 可留空，默认为 `https://api.mistral.ai` |
| OCR 模型 | 选择模型版本，默认跟随官方最新版 `mistral-ocr-latest` |
| 保留 Markdown 格式 | 默认去除格式符号输出纯文本，可选保留原始 Markdown |

## 模型版本

| 名称 | 模型 ID | 说明 |
|------|---------|------|
| 最新版（推荐） | `mistral-ocr-latest` | 始终指向 Mistral 官方最新 OCR 模型（当前为 OCR 4） |
| OCR 4 | `mistral-ocr-4-0` | 2026.06 发布，支持 170 种语言、边界框、块分类与置信度评分 |
| OCR 3 | `mistral-ocr-2512` | 2025.12 发布，复杂表格 / 手写 / 扫描件识别显著提升 |
| OCR 2 | `mistral-ocr-2505` | 2025.05 版本 |
| OCR | `mistral-ocr-2503` | 2025.03 首发版本 |

## 支持语言

中文简体、中文繁体、粤语、文言文、英语、日语、韩语、法语、德语、西班牙语、意大利语、葡萄牙语、葡萄牙语（巴西）、葡萄牙语（葡萄牙）、俄语、阿拉伯语、荷兰语、波兰语、泰语、越南语、土耳其语、印尼语、印地语、希伯来语、希腊语、乌克兰语、捷克语、瑞典语、丹麦语、芬兰语、挪威语、罗马尼亚语、匈牙利语

## 感谢

- [Bob](https://bobtranslate.com/) - macOS 翻译和 OCR 软件
- [Mistral AI](https://mistral.ai/) - OCR 能力提供方
