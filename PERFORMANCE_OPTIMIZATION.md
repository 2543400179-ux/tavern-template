# 性能警告分析与优化方案

## 📊 当前问题

构建时出现2个性能警告：

```
WARNING in asset size limit: The following asset(s) exceed the recommended size limit (244 KiB).
Assets: 
  index.html (559 KiB)

WARNING in webpack performance recommendations: 
You can limit the size of your bundles by using import() or require.ensure to lazy load some parts of your application.
```

### 问题根源

**visual-novel-ui 的 index.html 文件大小为 559 KiB**，超过 webpack 推荐的 244 KiB 限制。

原因：项目使用了以下内联插件（在 `webpack.config.ts` 第 430-436 行）：
- `HtmlInlineScriptWebpackPlugin` - 将所有 JS 内联到 HTML
- `HTMLInlineCSSWebpackPlugin` - 将所有 CSS 内联到 HTML

这意味着整个应用的 JavaScript 和 CSS 都被嵌入到单个 HTML 文件中。

---

## 🎯 优化方案

### 方案 1：禁用内联（推荐用于开发环境）⭐

**优点：**
- HTML 文件小，加载快
- 利用浏览器缓存
- 支持并行下载资源

**缺点：**
- 需要部署多个文件
- 首次加载可能需要多个 HTTP 请求

**实施方法：**

修改 `webpack.config.ts`，在第 421-437 行添加条件判断：

```typescript
plugins: (entry.html === undefined
  ? [new MiniCssExtractPlugin()]
  : [
      new HtmlWebpackPlugin({
        template: path.join(import.meta.dirname, entry.html),
        filename: path.parse(entry.html).base,
        scriptLoading: 'module',
        cache: false,
      }),
      // 仅在生产模式下内联（可选）
      ...(argv.mode === 'production' 
        ? [
            new HtmlInlineScriptWebpackPlugin(),
            new HTMLInlineCSSWebpackPlugin({
              styleTagFactory({ style }: { style: string }) {
                return `<style>${style}</style>`;
              },
            }),
          ]
        : []),
      new MiniCssExtractPlugin(),
    ]
)
```

---

### 方案 2：代码拆分（Code Splitting）

**优点：**
- 按需加载，减少初始包大小
- 提升首屏加载速度
- 更好的缓存策略

**实施方法：**

1. **动态导入大型组件**

在 `src/visual-novel-ui/App.tsx` 或主入口文件中：

```typescript
// 之前：
import CGConfigScreen from './components/CGConfigScreen';

// 之后：
const CGConfigScreen = lazy(() => import('./components/CGConfigScreen'));

// 使用时包裹在 Suspense 中
<Suspense fallback={<div>加载中...</div>}>
  <CGConfigScreen />
</Suspense>
```

2. **拆分第三方库**

在 `webpack.config.ts` 添加优化配置（在 `optimization` 部分）：

```typescript
optimization: {
  splitChunks: {
    chunks: 'all',
    cacheGroups: {
      vendor: {
        test: /[\\/]node_modules[\\/]/,
        name: 'vendors',
        priority: 10,
      },
      react: {
        test: /[\\/]node_modules[\\/](react|react-dom)[\\/]/,
        name: 'react-vendors',
        priority: 20,
      },
    },
  },
},
```

**注意：** 代码拆分与内联不兼容，需要先禁用内联插件。

---

### 方案 3：压缩优化

**优点：**
- 减小文件体积
- 兼容当前内联架构

**缺点：**
- 增加构建时间
- 调试困难

**实施方法：**

在 `webpack.config.ts` 的 `optimization` 部分强化压缩：

```typescript
optimization: {
  minimize: argv.mode === 'production',
  minimizer: [
    new TerserPlugin({
      terserOptions: {
        compress: {
          drop_console: true,  // 移除 console
          drop_debugger: true,
          pure_funcs: ['console.log'], // 移除特定函数
        },
        format: {
          comments: false,  // 移除注释
        },
      },
      extractComments: false,
    }),
    // CSS 压缩
    new CssMinimizerPlugin({
      minimizerOptions: {
        preset: [
          'default',
          {
            discardComments: { removeAll: true },
          },
        ],
      },
    }),
  ],
},
```

需要安装：
```bash
pnpm add -D css-minimizer-webpack-plugin
```

---

### 方案 4：Tree Shaking 优化

**检查未使用的代码：**

```bash
# 安装分析工具
pnpm add -D webpack-bundle-analyzer

# 在 webpack.config.ts 中添加
import { BundleAnalyzerPlugin } from 'webpack-bundle-analyzer';

// 在 plugins 中添加（仅开发时）
plugins: [
  // ... 其他插件
  ...(process.env.ANALYZE ? [new BundleAnalyzerPlugin()] : []),
]

# 运行分析
ANALYZE=true pnpm build
```

---

### 方案 5：禁用 Source Maps（生产环境）

在 `webpack.config.ts` 第 195 行：

```typescript
// 之前：
devtool: argv.mode === 'production' ? 'source-map' : 'eval-source-map',

// 之后（生产环境不生成 source map）：
devtool: argv.mode === 'production' ? false : 'eval-source-map',
```

这会减少 `index.js.map` (1.6 MB) 的生成。

---

### 方案 6：提升性能限制阈值

**如果你接受当前大小，可以调整警告阈值：**

在 `webpack.config.ts` 添加：

```typescript
performance: {
  maxAssetSize: 600000,     // 600 KB
  maxEntrypointSize: 600000, // 600 KB
  hints: argv.mode === 'production' ? 'warning' : false,
}
```

---

## 🚀 推荐实施步骤

### 短期（立即可做）
1. ✅ **提升性能限制阈值**（方案 6）- 5分钟
2. ✅ **禁用生产环境 Source Maps**（方案 5）- 2分钟
3. ✅ **强化压缩配置**（方案 3）- 10分钟

### 中期（需要测试）
4. **条件性内联**（方案 1）- 20分钟
   - 开发环境：外部文件
   - 生产环境：保持内联（如需单文件部署）

### 长期（架构优化）
5. **代码拆分**（方案 2）- 1-2小时
   - 分析包大小
   - 按路由/功能拆分
   - 实施懒加载

---

## 📈 预期效果

| 方案 | HTML 大小减少 | 总体积减少 | 实施难度 |
|------|--------------|-----------|---------|
| 方案 1（禁用内联）| -95% (30KB) | 0% | 简单 |
| 方案 2（代码拆分）| -95% | 0-10% | 中等 |
| 方案 3（压缩优化）| -15% (475KB) | -20% | 简单 |
| 方案 5（禁用 Source Maps）| 0% | -75% (dev only) | 简单 |
| 方案 6（调整阈值）| 0% | 0% | 极简单 |

---

## ⚠️ 注意事项

1. **内联的用途**：
   - 如果你需要**单文件部署**（例如作为浏览器扩展或独立 HTML 游戏），保持内联是合理的
   - 如果部署到 Web 服务器，建议禁用内联

2. **浏览器兼容性**：
   - 代码拆分需要浏览器支持动态 `import()`
   - 当前 browserslist 配置已支持

3. **调试体验**：
   - 开发环境建议保留 Source Maps
   - 生产环境可以禁用以减小体积

---

## 🔧 快速修复脚本

创建 `scripts/optimize-build.js`：

```javascript
const fs = require('fs');
const path = require('path');

// 检查 dist 文件大小
const distPath = path.join(__dirname, '../dist/visual-novel-ui');
const files = fs.readdirSync(distPath);

console.log('📦 Build Size Report:\n');
files.forEach(file => {
  const stats = fs.statSync(path.join(distPath, file));
  const sizeKB = (stats.size / 1024).toFixed(2);
  const icon = sizeKB > 244 ? '⚠️' : '✅';
  console.log(`${icon} ${file}: ${sizeKB} KB`);
});
```

运行：
```bash
node scripts/optimize-build.js
```

---

## 📚 参考资源

- [Webpack Code Splitting](https://webpack.js.org/guides/code-splitting/)
- [React Lazy Loading](https://react.dev/reference/react/lazy)
- [Webpack Performance](https://webpack.js.org/configuration/performance/)

---

**生成时间：** 2026-06-20  
**项目：** tavern_helper_template
