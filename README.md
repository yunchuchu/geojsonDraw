# GeoJSON Draw Tool

基于 `Vue 3 + 高德 JSAPI 2.0` 的 GeoJSON 手动绘制工具，支持点/面绘制、编辑、删除和导出。

## 配置高德 Key

1. 复制配置模板：
   - `cp .env.example .env`
2. 在 `.env` 中填写你的高德 Key：
   - `VITE_AMAP_KEY=你的高德Web端Key`
   - `VITE_AMAP_SEARCH_KEY=你的高德Web服务Key`（用于搜索，建议单独配置）
   - `VITE_AMAP_MAP_STYLE=amap://styles/normal`（可选，JSAPI 底图样式）
   - `VITE_AMAP_SECURITY_JS_CODE=你的安全密钥`（可选，建议配置）
3. 启动项目：
   - `npm install`
   - `npm run dev`

如果页面提示“未检测到 VITE_AMAP_KEY”或“高德底图加载失败”，请检查 Key、安全密钥、域名白名单是否包含当前访问地址（如 `localhost`、`127.0.0.1`）。
如果搜索提示“平台类型不匹配”，请确认 `VITE_AMAP_SEARCH_KEY` 使用的是高德控制台中的 **Web 服务 Key**。
如果你感觉底图和官网不一致，可优先调整 `VITE_AMAP_MAP_STYLE`（如 `amap://styles/normal`、`amap://styles/dark`）后刷新页面对比。
