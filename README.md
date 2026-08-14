# Mistral OCR - Bob 文本识别插件

基于 [Mistral AI OCR](https://docs.mistral.ai/studio-api/document-processing/basic_ocr) 的 [Bob](https://bobtranslate.com/) 文本识别（OCR）插件。

## 功能

- 调用 Mistral OCR API 识别图片中的文字
- 可选择 OCR 模型版本：最新版、OCR 4.1（26.07）、OCR 4（26.06）、OCR 3（25.12）
- 支持多语言识别（中文简繁、粤语、文言文、英、日、韩、葡（葡/巴）等 30+ 种语言）
- 支持表格、公式等复杂排版识别
- 可选保留 Markdown 格式或输出纯文本
- 支持安全的自定义 API 地址（远程代理必须使用 HTTPS，本机回环调试可使用 HTTP）
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
| 自定义 API 地址 | 可留空，默认为 `https://api.mistral.ai`；远程地址必须使用 HTTPS，仅 `localhost` / 回环地址可使用 HTTP |
| OCR 模型 | 选择模型版本，默认跟随官方最新版 `mistral-ocr-latest` |
| 保留 Markdown 格式 | 默认去除格式符号输出纯文本，可选保留原始 Markdown |

## 模型版本

| 名称 | 模型 ID | 说明 |
|------|---------|------|
| 最新版（推荐） | `mistral-ocr-latest` | 始终指向 Mistral 官方最新 OCR 模型（当前为 OCR 4.1） |
| [OCR 4.1](https://docs.mistral.ai/models/ocr-4-1) | `mistral-ocr-4-1` | 2026.07 发布（公开预览），新增区块级置信度评分 |
| OCR 4 | `mistral-ocr-4-0` | 2026.06 发布，支持 170 种语言、边界框、块分类与置信度评分 |
| OCR 3 | `mistral-ocr-2512` | 2025.12 发布，复杂表格 / 手写 / 扫描件识别显著提升 |

> 已退役模型（`mistral-ocr-2505`、`mistral-ocr-2503`）已从选项中移除；若你之前选过旧版，插件会自动回退到最新版。

> OCR 4.1 当前仍处于公开预览；如需固定使用此前的正式版本，可在设置中选择 OCR 4（`mistral-ocr-4-0`）。

## 从 0.4.0 或更早版本迁移

v0.5.0 将插件标识符从 `com.poyih.bob-plugin-mistral-ocr` 改为 `bob-plugin-mistral-ocr`。Bob 要求 appcast 标识符与已安装插件完全一致，因此一个静态 appcast 无法同时为两个标识符提供自动升级；v0.5.0 及之后的用户不受影响。

如果你仍在使用 v0.4.0 或更早版本，请先确保自己仍可取得 API Key，再在 Bob 中卸载旧插件并从 [Releases](https://github.com/poyih/bob-plugin-mistral-ocr/releases) 手动安装最新版，最后重新填写设置。直接并行安装可能会留下两个独立插件。

## 发布完整性

`appcast.json` 只记录当前标识符下确实存在且可下载的 Release 资产，版本号不连续是正常的。历史发布包以 appcast 中固定的 SHA-256 为准；已经发布的资产和 Git tag 不做追溯改写。已知的旧标识符版本、未实际发布的版本号以及历史 tag/发布包差异记录在 [`release-provenance.json`](release-provenance.json)。

提交发布元数据前可运行：

```bash
node scripts/validate-release-metadata.mjs
```

在具有完整 Git tags、`unzip` 和网络连接的环境中，可进一步核验所有 Release 下载、SHA-256、包内元数据及 tag 差异：

```bash
node scripts/validate-release-metadata.mjs --check-assets --check-tags
```

## 支持语言

中文简体、中文繁体、粤语、文言文、英语、日语、韩语、法语、德语、西班牙语、意大利语、葡萄牙语、葡萄牙语（巴西）、葡萄牙语（葡萄牙）、俄语、阿拉伯语、荷兰语、波兰语、泰语、越南语、土耳其语、印尼语、印地语、希伯来语、希腊语、乌克兰语、捷克语、瑞典语、丹麦语、芬兰语、挪威语、罗马尼亚语、匈牙利语

## 感谢

- [Bob](https://bobtranslate.com/) - macOS 翻译和 OCR 软件
- [Mistral AI](https://mistral.ai/) - OCR 能力提供方
